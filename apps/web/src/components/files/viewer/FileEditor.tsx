/**
 * The read-only CodeMirror 6 editor of the file viewer (issue #154).
 *
 * The theme is built from the MUI theme (the Option A `BRAND` tokens of
 * `@shellkeep/shared`, through `platform/shellTheme.ts`), so light and dark
 * follow the app and no hex literal lives here. The language pack is loaded
 * on demand (`lib/files/viewer/languages.ts`); logs get a level highlighter
 * instead of a grammar.
 *
 * The document is read-only but stays focusable, so selection, the keyboard
 * and the search panel (Ctrl/Cmd+F) work.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror, {
  Decoration,
  EditorState,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  type DecorationSet,
  type Extension,
  type ReactCodeMirrorRef,
  type ViewUpdate,
} from '@uiw/react-codemirror';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { openSearchPanel } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';
import { alpha, useTheme, type Theme } from '@mui/material/styles';
import type { FileLanguage } from '../../../lib/files/viewer/language';
import { loadLanguage } from '../../../lib/files/viewer/languages';
import { LOG_LEVEL_PATTERN } from '../../../lib/files/viewer/text';

export interface FileEditorProps {
  value: string;
  language: FileLanguage;
  wrap: boolean;
  lineNumbers: boolean;
  fontFamily: string;
  fontSize: number;
  /** 1-based line to select and centre once the document is shown. */
  line?: number;
  /** Changing this scrolls to the end of the document (tail, follow). */
  scrollToEndKey?: number;
  /** The accessible name of the editor's content. */
  ariaLabel: string;
  /** Receives the editor's handle once it exists, `null` when it goes. */
  onReady?: (handle: FileEditorHandle | null) => void;
}

/**
 * What the viewer may do with the editor. A handle rather than the view, so
 * the viewer's own chunk never imports CodeMirror (a download card or an
 * image never loads it).
 */
export interface FileEditorHandle {
  openSearch: () => void;
}

/** The editor chrome, from the MUI palette. */
export function editorTheme(theme: Theme, fontFamily: string, fontSize: number): Extension {
  const p = theme.palette;
  const dark = p.mode === 'dark';
  return [
    EditorView.theme(
      {
        '&': { backgroundColor: p.background.paper, color: p.text.primary, height: '100%', fontSize: `${fontSize}px` },
        '.cm-scroller': { fontFamily, lineHeight: 1.5 },
        '.cm-content': { caretColor: p.primary.main },
        '.cm-cursor, .cm-dropCursor': { borderLeftColor: p.primary.main },
        '.cm-gutters': {
          backgroundColor: p.background.default,
          color: p.text.secondary,
          borderRight: `1px solid ${p.divider}`,
        },
        '.cm-activeLine': { backgroundColor: alpha(p.primary.main, dark ? 0.1 : 0.06) },
        '.cm-activeLineGutter': { backgroundColor: alpha(p.primary.main, dark ? 0.16 : 0.1), color: p.text.primary },
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
          backgroundColor: alpha(p.primary.main, dark ? 0.35 : 0.22),
        },
        '&.cm-focused': { outline: `2px solid ${p.primary.main}`, outlineOffset: '-2px' },
        '.cm-searchMatch': { backgroundColor: alpha(p.warning.main, 0.3) },
        '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: alpha(p.primary.main, 0.4) },
        '.cm-panels': { backgroundColor: p.background.default, color: p.text.primary },
        '.cm-panels.cm-panels-top': { borderBottom: `1px solid ${p.divider}` },
        '.cm-panels.cm-panels-bottom': { borderTop: `1px solid ${p.divider}` },
        '.cm-textfield': { color: p.text.primary, borderColor: p.divider },
        '.cm-button': { color: p.text.primary, backgroundImage: 'none', backgroundColor: p.background.paper },
        '.cm-log-error': { color: p.error.main, fontWeight: 700 },
        '.cm-log-warn': { color: p.warning.main, fontWeight: 700 },
        '.cm-log-info': { color: p.info.main, fontWeight: 600 },
      },
      { dark },
    ),
    syntaxHighlighting(
      HighlightStyle.define([
        { tag: [t.keyword, t.tagName, t.heading, t.typeName], color: p.primary.main },
        { tag: t.heading, fontWeight: 700 },
        { tag: [t.string, t.special(t.string), t.monospace], color: p.success.main },
        { tag: [t.number, t.bool, t.null, t.atom], color: p.warning.main },
        { tag: [t.comment, t.meta, t.quote], color: p.text.secondary, fontStyle: 'italic' },
        { tag: [t.propertyName, t.attributeName, t.definition(t.propertyName), t.link], color: p.info.main },
        { tag: t.link, textDecoration: 'underline' },
        { tag: t.strong, fontWeight: 700 },
        { tag: t.emphasis, fontStyle: 'italic' },
        { tag: [t.operator, t.punctuation, t.contentSeparator], color: p.text.secondary },
        { tag: t.invalid, color: p.error.main },
      ]),
    ),
  ];
}

const LEVEL_CLASS = ['cm-log-error', 'cm-log-warn', 'cm-log-info'] as const;

/** Marks ERROR, WARN and INFO words (and their synonyms) in a log. */
export const logLevelHighlighter: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    private readonly matcher = new MatchDecorator({
      regexp: new RegExp(LOG_LEVEL_PATTERN.source, 'g'),
      decoration: (match) =>
        Decoration.mark({ class: LEVEL_CLASS[match[1] ? 0 : match[2] ? 1 : 2] }),
    });
    constructor(view: EditorView) {
      this.decorations = this.matcher.createDeco(view);
    }
    update(update: ViewUpdate) {
      this.decorations = this.matcher.updateDeco(update, this.decorations);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

export default function FileEditor({
  value,
  language,
  wrap,
  lineNumbers,
  fontFamily,
  fontSize,
  line,
  scrollToEndKey,
  ariaLabel,
  onReady,
}: FileEditorProps) {
  const theme = useTheme();
  const ref = useRef<ReactCodeMirrorRef>(null);
  const [languageExtension, setLanguageExtension] = useState<Extension>([]);
  const [view, setView] = useState<EditorView | null>(null);

  useEffect(() => {
    let live = true;
    setLanguageExtension([]);
    loadLanguage(language)
      .then((extension) => {
        if (live) setLanguageExtension(extension);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [language]);

  const themeExtension = useMemo(() => editorTheme(theme, fontFamily, fontSize), [theme, fontFamily, fontSize]);

  const extensions = useMemo(
    () => [
      EditorState.readOnly.of(true),
      EditorView.contentAttributes.of({ 'aria-label': ariaLabel, 'aria-readonly': 'true' }),
      ...(wrap ? [EditorView.lineWrapping] : []),
      ...(language === 'log' ? [logLevelHighlighter] : []),
      languageExtension,
    ],
    [ariaLabel, wrap, language, languageExtension],
  );

  useEffect(() => {
    onReady?.(view ? { openSearch: () => openSearchPanel(view) } : null);
  }, [view, onReady]);
  useEffect(() => () => onReady?.(null), [onReady]);

  // Jump to the requested line, once per (line, document) the view shows.
  const jumpedRef = useRef<number | null>(null);
  useEffect(() => {
    if (!view || !line || jumpedRef.current === line) return;
    const doc = view.state.doc;
    if (doc.length === 0 && value.length > 0) return;
    jumpedRef.current = line;
    const target = doc.line(Math.min(Math.max(1, line), doc.lines));
    view.dispatch({
      selection: { anchor: target.from, head: target.to },
      effects: EditorView.scrollIntoView(target.from, { y: 'center' }),
    });
  }, [view, line, value]);

  // Tail and follow: keep the end in sight.
  useEffect(() => {
    if (!view || scrollToEndKey === undefined) return;
    view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.length, { y: 'end' }) });
  }, [view, scrollToEndKey]);

  return (
    <CodeMirror
      ref={ref}
      value={value}
      height="100%"
      style={{ height: '100%' }}
      theme={themeExtension}
      editable
      readOnly
      extensions={extensions}
      onCreateEditor={(created) => setView(created)}
      basicSetup={{
        lineNumbers,
        foldGutter: false,
        highlightActiveLine: true,
        highlightActiveLineGutter: lineNumbers,
        autocompletion: false,
        closeBrackets: false,
        bracketMatching: true,
        searchKeymap: true,
        highlightSelectionMatches: true,
      }}
    />
  );
}
