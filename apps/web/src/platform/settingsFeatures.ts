/**
 * The deployment feature map the registries read (issue #55).
 *
 * `useSettingsFeatures()` (`@marinoscar/platform-web/settings/headless`) asks
 * every resolver registered here, in registration order, and the hubs, the
 * Console rail, the AppBar title resolver and `isDestinationVisible` all read
 * that one map. A card or destination with `feature: 'ai'` exists only while
 * the AI kill switch is on: `useAiFeatures()` reads `AiConfigProvider`
 * (`App.tsx`), never fetches, and answers "off" without a provider, so a
 * missing provider fails closed.
 *
 * Imported for its side effect by `App.tsx`, at module scope: the feature set
 * is fixed once the first `useSettingsFeatures()` render ran.
 */

import { useAiFeatures } from '@marinoscar/platform-web/ai/headless';
import { registerSettingsFeature } from '@marinoscar/platform-web/settings/headless';

registerSettingsFeature('ai', () => useAiFeatures().ai);
