import { Box, useTheme } from '@mui/material';
import { Outlet } from 'react-router-dom';
import { useState, useCallback } from 'react';
import { MaintenanceBanner } from '@marinoscar/platform-web/host/ui';
import { usePushSubscriptionSync } from '@marinoscar/platform-web/notifications/headless';
import { NotificationPermissionBanner } from '@marinoscar/platform-web/notifications/ui';
import { AppBar } from '../navigation/AppBar';
import { Sidebar } from '../navigation/Sidebar';

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const theme = useTheme();
  // #51: mounted here, once, because the layout exists exactly for a signed-in
  // user. Keeps this device's Web Push subscription registered on every load
  // when push is configured, and offers the permission prompt.
  const pushSync = usePushSubscriptionSync();

  const handleSidebarToggle = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  const handleSidebarClose = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: theme.palette.background.default,
      }}
    >
      <AppBar onMenuClick={handleSidebarToggle} />
      <Box sx={{ display: 'flex', flexGrow: 1, minHeight: 0 }}>
        <Sidebar open={sidebarOpen} onClose={handleSidebarClose} />
        <Box
          component="main"
          sx={{
            flexGrow: 1,
            p: 3,
            overflow: 'auto',
          }}
        >
          {/* An open maintenance window, for an administrator it lets through
              (#46). Renders nothing for everyone else. */}
          <MaintenanceBanner />
          {/* Renders nothing unless this device still needs to allow (or
              unblock, or install for) notifications (#51). */}
          <NotificationPermissionBanner
            config={pushSync.config}
            capability={pushSync.capability}
            onRequestPermission={() => void pushSync.requestPermission()}
            isRequestingPermission={pushSync.isRequestingPermission}
          />
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
