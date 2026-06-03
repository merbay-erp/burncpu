// Ship a single-architecture (arm64-v8a) release APK so the sideloaded download
// stays small (~40 MB instead of the ~114 MB universal build). Every Android
// phone from ~2017 on is arm64-v8a; the universal APK's other slices
// (armeabi-v7a / x86 / x86_64) were pure dead weight for our distribution and
// also tripped a longer Play Protect scan. This sets the React Native gradle
// `reactNativeArchitectures` property, which controls which ABIs' native
// libraries (RN, Hermes, Expo modules) end up in the non-split release APK.
const { withGradleProperties } = require('@expo/config-plugins');

module.exports = function withSingleAbi(config) {
  return withGradleProperties(config, (cfg) => {
    cfg.modResults = cfg.modResults.filter(
      (item) => !(item.type === 'property' && item.key === 'reactNativeArchitectures'),
    );
    cfg.modResults.push({
      type: 'property',
      key: 'reactNativeArchitectures',
      value: 'arm64-v8a',
    });
    return cfg;
  });
};
