import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { captureTwaLaunch } from '@marinoscar/platform-web/android-app/headless';
import { ANDROID_TWA_KEY_PREFIX } from './config/androidApp';

// Remember an Android app (Trusted Web Activity) launch and the installed build
// before the router drops `?source=twa&appVersion=&appVersionCode=` (#74).
captureTwaLaunch(undefined, ANDROID_TWA_KEY_PREFIX);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
