/**
 * The Servers page's detail drawer (#79): opened by a row's name or its "Details" action. It shows
 * the profile's fields (never a credential), the health of the last test, the host key with its
 * trust actions (#60, the form's own `HostKeySection`), the caller's recent sessions on the server,
 * the recent runs and an inline tags editor for a caller who may write the profile.
 *
 * A Files tab (#156) browses the server over the files API, rooted at `~` and without a session.
 * It is parallel content of the same destination, shown only to a caller who may open a terminal
 * there (`sessions:write` and connect rights on the profile), the files API's access rule.
 */

import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { usePermissions } from '@marinoscar/platform-web/identity/headless';
import type { ServerProfile, TerminalSession } from '../../types';
import { getSessions, updateServerProfile } from '../../services/terminal-api';
import { factsSummary } from '../../lib/terminal/host-key';
import { relativeTime } from '../../lib/servers/relativeTime';
import { HostKeySection } from './HostKeySection';
import { ServerHealthStatus } from './ServerHealthStatus';
import { TagsInput, mergeTags } from './TagsInput';
import { ownerLabel } from './ServerOwnerChip';
import { FileBrowser } from '../files/browser/FileBrowser';
import { TERMINAL_WRITE_PERMISSION } from '../terminal/TerminalAccessGate';

const AUTH_METHOD_LABELS: Record<string, string> = { password: 'Password', key: 'SSH key', agent: 'SSH agent' };

export interface ServerDetailDrawerProps {
  profile: ServerProfile | null;
  onClose: () => void;
  /** The tags in use, for the tags autocomplete. */
  tagOptions: readonly string[];
  /** Called with the profile after a tags save, a trust or a facts refresh. */
  onProfileChanged: (profile: ServerProfile) => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', gap: 1, py: 0.5, minWidth: 0 }}>
      <Typography variant="body2" sx={{ color: 'text.secondary', width: 120, flexShrink: 0 }}>
        {label}
      </Typography>
      <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{children}</Box>
    </Box>
  );
}

export function ServerDetailDrawer({ profile, onClose, tagOptions, onProfileChanged }: ServerDetailDrawerProps) {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const [tab, setTab] = useState<'details' | 'files'>('details');
  const [sessions, setSessions] = useState<TerminalSession[] | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [pendingTag, setPendingTag] = useState('');
  const [savingTags, setSavingTags] = useState(false);
  const [tagsNotice, setTagsNotice] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);

  const profileId = profile?.id ?? null;
  useEffect(() => {
    setTags(profile?.tags ?? []);
    setPendingTag('');
    setTagsNotice(null);
    setTab('details');
    // Re-seed only when another profile opens, not on every refresh of the same one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    setSessions(null);
    setSessionsError(null);
    getSessions({ serverProfileId: profileId, pageSize: 5 })
      .then((response) => !cancelled && setSessions(response?.items ?? []))
      .catch((error: unknown) => {
        if (!cancelled) setSessionsError(error instanceof Error ? error.message : 'Could not load the sessions');
      });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  const canWrite = profile?.access ? profile.access.can.write : true;
  const nextTags = mergeTags(tags, pendingTag);
  const tagsDirty = !!profile && (nextTags.length !== profile.tags.length || nextTags.some((tag, i) => tag !== profile.tags[i]));

  const saveTags = async () => {
    if (!profile) return;
    setSavingTags(true);
    setTagsNotice(null);
    try {
      const saved = await updateServerProfile(profile.id, { tags: nextTags });
      setTags(saved.tags);
      setPendingTag('');
      onProfileChanged(saved);
      setTagsNotice({ severity: 'success', text: 'Tags saved' });
    } catch (error) {
      setTagsNotice({ severity: 'error', text: error instanceof Error ? error.message : 'Could not save the tags' });
    } finally {
      setSavingTags(false);
    }
  };

  const facts = factsSummary(profile?.facts);
  const canBrowse = !!profile && hasPermission(TERMINAL_WRITE_PERMISSION) && (profile.access?.can.connect ?? true);
  const showFiles = canBrowse && tab === 'files';

  return (
    <Drawer
      anchor="right"
      open={!!profile}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: '100%', sm: showFiles ? 560 : 440 }, maxWidth: '100vw' } } }}
    >
      {profile && (
        <Box
          sx={{ p: 2, ...(showFiles ? { display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box' } : {}) }}
          role="region"
          aria-label={`Server ${profile.name}`}
          data-testid="server-detail-drawer"
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Typography variant="h6" component="h2" sx={{ flexGrow: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
              {profile.name}
            </Typography>
            <IconButton aria-label="Close details" onClick={onClose}>
              <CloseIcon />
            </IconButton>
          </Box>

          {canBrowse && (
            <Tabs
              value={tab}
              onChange={(_e, next: 'details' | 'files') => setTab(next)}
              aria-label="Server sections"
              sx={{ mb: 1, borderBottom: 1, borderColor: 'divider', minHeight: 40, '& .MuiTab-root': { minHeight: 40 } }}
            >
              <Tab value="details" label="Details" id="server-tab-details" aria-controls="server-panel-details" />
              <Tab value="files" label="Files" id="server-tab-files" aria-controls="server-panel-files" />
            </Tabs>
          )}

          {showFiles ? (
            <Box
              role="tabpanel"
              id="server-panel-files"
              aria-labelledby="server-tab-files"
              sx={{ flex: 1, minHeight: 0, mx: -2, mb: -2 }}
            >
              <FileBrowser profileId={profile.id} initialPath="~" aria-label={`Files on ${profile.name}`} />
            </Box>
          ) : (
            <Box role={canBrowse ? 'tabpanel' : undefined} id="server-panel-details" aria-labelledby={canBrowse ? 'server-tab-details' : undefined}>
              <Field label="Host">
                {profile.hostname}:{profile.port}
              </Field>
              <Field label="Username">{profile.username}</Field>
              <Field label="Authentication">{AUTH_METHOD_LABELS[profile.authMethod] ?? profile.authMethod}</Field>
              <Field label="Owner">{ownerLabel(profile)}</Field>
              <Field label="Health">
                <ServerHealthStatus profile={profile} />
              </Field>
              {facts.length > 0 && <Field label="System">{facts.join(' · ')}</Field>}
              <Field label="AI output">{profile.aiOutputSharing === false ? 'Never shared with AI' : 'Shared after redaction'}</Field>

              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle2" component="h3" sx={{ mb: 1 }}>
                Tags
              </Typography>
              {canWrite ? (
                <Stack spacing={1}>
                  <TagsInput
                    value={tags}
                    onChange={setTags}
                    onPendingChange={setPendingTag}
                    options={tagOptions}
                    size="small"
                    disabled={savingTags}
                    data-testid="drawer-tags-input"
                  />
                  <Box>
                    <Button size="small" variant="outlined" onClick={() => void saveTags()} disabled={!tagsDirty || savingTags}>
                      Save tags
                    </Button>
                  </Box>
                </Stack>
              ) : profile.tags.length > 0 ? (
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  {profile.tags.map((tag) => (
                    <Chip key={tag} size="small" label={tag} />
                  ))}
                </Box>
              ) : (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  No tags
                </Typography>
              )}
              {tagsNotice && (
                <Alert severity={tagsNotice.severity} sx={{ mt: 1 }}>
                  {tagsNotice.text}
                </Alert>
              )}

              <Divider sx={{ my: 2 }} />
              <HostKeySection profile={profile} onProfileChanged={onProfileChanged} />

              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle2" component="h3">
                Your recent sessions
              </Typography>
              {sessionsError && <Alert severity="error">{sessionsError}</Alert>}
              {sessions === null && !sessionsError && (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Loading…
                </Typography>
              )}
              {sessions?.length === 0 && (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  No sessions on this server yet.
                </Typography>
              )}
              {sessions && sessions.length > 0 && (
                <List dense disablePadding aria-label="Recent sessions">
                  {sessions.map((session) => (
                    <ListItemButton key={session.id} onClick={() => navigate(`/sessions/${session.id}`)}>
                      <ListItemText
                        primary={session.name}
                        secondary={`${session.status} · ${relativeTime(session.lastActivityAt)}`}
                      />
                    </ListItemButton>
                  ))}
                </List>
              )}

              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle2" component="h3">
                Recent runs
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }} data-testid="drawer-recent-runs">
                {/* TODO(#66): list the runbook runs that targeted this server once the run history has a server filter. */}
                Runbook runs on this server appear here once the run history lands.
              </Typography>
            </Box>
          )}
        </Box>
      )}
    </Drawer>
  );
}
