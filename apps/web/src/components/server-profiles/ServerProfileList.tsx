import { useState, useEffect } from 'react';
import {
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  TextField,
  Button,
  IconButton,
  Chip,
  Box,
  Typography,
  Tooltip,
  CircularProgress,
  Alert,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Add as AddIcon,
  Edit as EditIcon,
  NetworkCheck as TestIcon,
} from '@mui/icons-material';
import type { ServerProfile, ServerProfileFormData } from '../../types';
import { useServerProfiles } from '../../hooks/useServerProfiles';
import { ServerProfileForm } from './ServerProfileForm';

interface ServerProfileListProps {
  onTestResult?: (result: { success: boolean; error?: string }) => void;
  onDeleteSuccess?: () => void;
  onError?: (message: string) => void;
}

const AUTH_METHOD_LABELS: Record<string, string> = {
  password: 'Password',
  key: 'SSH Key',
  agent: 'SSH Agent',
};

export function ServerProfileList({
  onTestResult,
  onDeleteSuccess,
  onError,
}: ServerProfileListProps) {
  const {
    profiles,
    total,
    isLoading,
    error,
    fetchProfiles,
    createProfile,
    updateProfile,
    deleteProfile,
    testConnection,
  } = useServerProfiles();

  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [formOpen, setFormOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ServerProfile | null>(
    null,
  );
  const [testingId, setTestingId] = useState<string | null>(null);

  useEffect(() => {
    fetchProfiles({
      page: currentPage + 1,
      pageSize: rowsPerPage,
      search: search || undefined,
    });
  }, [currentPage, rowsPerPage, search, fetchProfiles]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setCurrentPage(0);
  };

  const handleChangePage = (_: unknown, newPage: number) => {
    setCurrentPage(newPage);
  };

  const handleChangeRowsPerPage = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setCurrentPage(0);
  };

  const handleCreate = () => {
    setEditingProfile(null);
    setFormOpen(true);
  };

  const handleEdit = (profile: ServerProfile) => {
    setEditingProfile(profile);
    setFormOpen(true);
  };

  const handleSave = async (data: ServerProfileFormData) => {
    if (editingProfile) {
      await updateProfile(editingProfile.id, data);
    } else {
      await createProfile(data);
    }
  };

  const handleDelete = async (id: string) => {
    if (
      window.confirm(
        'Are you sure you want to delete this server profile?',
      )
    ) {
      try {
        await deleteProfile(id);
        onDeleteSuccess?.();
      } catch (err) {
        onError?.(
          err instanceof Error ? err.message : 'Failed to delete profile',
        );
      }
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const result = await testConnection(id);
      onTestResult?.(result);
    } finally {
      setTestingId(null);
    }
  };

  return (
    <Paper sx={{ width: '100%', overflow: 'hidden' }}>
      <Box sx={{ p: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
        <TextField
          label="Search servers"
          variant="outlined"
          size="small"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          sx={{ flexGrow: 1 }}
        />
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={handleCreate}
        >
          Add Server
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mx: 2, mb: 2 }}>
          {error}
        </Alert>
      )}

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      ) : profiles.length === 0 ? (
        <Box sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            {search
              ? 'No servers found matching your search'
              : 'No server profiles yet. Click "Add Server" to create one.'}
          </Typography>
        </Box>
      ) : (
        <>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Host</TableCell>
                  <TableCell>Username</TableCell>
                  <TableCell>Auth Method</TableCell>
                  <TableCell>Tags</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {profiles.map((profile) => (
                  <TableRow key={profile.id} hover>
                    <TableCell>{profile.name}</TableCell>
                    <TableCell>
                      {profile.hostname}:{profile.port}
                    </TableCell>
                    <TableCell>{profile.username}</TableCell>
                    <TableCell>
                      {AUTH_METHOD_LABELS[profile.authMethod] ||
                        profile.authMethod}
                    </TableCell>
                    <TableCell>
                      {profile.tags.length > 0 ? (
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                          {profile.tags.map((tag) => (
                            <Chip key={tag} label={tag} size="small" />
                          ))}
                        </Box>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          -
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Edit">
                        <IconButton
                          size="small"
                          onClick={() => handleEdit(profile)}
                        >
                          <EditIcon />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Test Connection">
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => handleTest(profile.id)}
                            disabled={testingId === profile.id}
                          >
                            {testingId === profile.id ? (
                              <CircularProgress size={20} />
                            ) : (
                              <TestIcon />
                            )}
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton
                          size="small"
                          onClick={() => handleDelete(profile.id)}
                          color="error"
                        >
                          <DeleteIcon />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            component="div"
            count={total}
            page={currentPage}
            onPageChange={handleChangePage}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={handleChangeRowsPerPage}
            rowsPerPageOptions={[5, 10, 25, 50]}
          />
        </>
      )}

      <ServerProfileForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSave={handleSave}
        profile={editingProfile}
      />
    </Paper>
  );
}
