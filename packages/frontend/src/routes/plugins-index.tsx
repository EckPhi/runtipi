import { redirect } from 'react-router';

// Plugins are browsed in the Plugins tab of the app store.
export async function clientLoader() {
  return redirect('/app-store?tab=plugins');
}

export default function PluginsIndex() {
  return null;
}
