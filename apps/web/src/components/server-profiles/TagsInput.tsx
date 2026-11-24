/**
 * A tags field: chips plus an autocomplete over the tags already in use (#79). Free text is
 * allowed; a comma or Enter commits a tag. `pendingRef` lets a form read text typed but not yet
 * committed, so "prod, web" typed and saved at once is not lost.
 */

import { useState } from 'react';
import { Autocomplete, Chip, TextField } from '@mui/material';

export interface TagsInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  options: readonly string[];
  label?: string;
  placeholder?: string;
  helperText?: string;
  disabled?: boolean;
  /** Text typed and not committed yet, reported on every keystroke. */
  onPendingChange?: (text: string) => void;
  size?: 'small' | 'medium';
  'data-testid'?: string;
}

/** Splits typed text into tags: trimmed, non-empty, without repeats. */
export function splitTags(text: string): string[] {
  return [...new Set(text.split(',').map((tag) => tag.trim()).filter(Boolean))];
}

/** `value` plus the pending text's tags, without repeats. */
export function mergeTags(value: readonly string[], pending: string): string[] {
  return [...new Set([...value, ...splitTags(pending)])];
}

export function TagsInput({
  value,
  onChange,
  options,
  label = 'Tags',
  placeholder,
  helperText,
  disabled,
  onPendingChange,
  size,
  'data-testid': testId,
}: TagsInputProps) {
  const [input, setInput] = useState('');
  const setPending = (text: string) => {
    setInput(text);
    onPendingChange?.(text);
  };
  return (
    <Autocomplete
      multiple
      freeSolo
      size={size}
      disabled={disabled}
      options={options.filter((option) => !value.includes(option))}
      value={value}
      inputValue={input}
      onInputChange={(_, text, reason) => {
        if (reason === 'reset') return setPending('');
        // A comma commits what is before it.
        if (text.includes(',')) {
          onChange(mergeTags(value, text));
          return setPending('');
        }
        setPending(text);
      }}
      onChange={(_, next) => {
        onChange(mergeTags(next.map(String), ''));
        setPending('');
      }}
      onBlur={() => {
        if (input.trim()) {
          onChange(mergeTags(value, input));
          setPending('');
        }
      }}
      renderValue={(tags, getItemProps) =>
        tags.map((tag, index) => {
          const { key, ...itemProps } = getItemProps({ index });
          return <Chip key={key} size="small" label={tag} {...itemProps} />;
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder}
          helperText={helperText}
          slotProps={{ ...params.slotProps, htmlInput: { ...params.slotProps.htmlInput, 'data-testid': testId } }}
        />
      )}
    />
  );
}
