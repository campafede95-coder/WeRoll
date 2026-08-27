import type { ConfigContext } from 'expo/config';

export default function configureApp({ config }: ConfigContext) {
  return {
    ...config,
    android: {
      ...config.android,
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
    },
  };
}