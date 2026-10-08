const {
  createRunOncePlugin,
  withAppBuildGradle,
} = require("expo/config-plugins");

const EXCLUDED_RESOURCE = "META-INF/versions/9/OSGI-INF/MANIFEST.MF";

function withAndroidPackagingExclusion(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.contents.includes(EXCLUDED_RESOURCE)) {
      return config;
    }

    config.modResults.contents = `${config.modResults.contents.trimEnd()}

android {
    packagingOptions {
        resources {
            excludes += ["${EXCLUDED_RESOURCE}"]
        }
    }
}
`;

    return config;
  });
}

module.exports = createRunOncePlugin(
  withAndroidPackagingExclusion,
  "pic-sync-android-packaging-exclusion",
  "1.0.0"
);