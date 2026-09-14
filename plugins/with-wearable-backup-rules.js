const fs = require('node:fs/promises');
const path = require('node:path');
const { withDangerousMod } = require('expo/config-plugins');

const LEGACY_BACKUP_RULES = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
  <include domain="sharedpref" path="." />
  <exclude domain="sharedpref" path="SecureStore" />
  <exclude domain="sharedpref" path="na_pivo_wearable_bridge_v1.xml" />
</full-backup-content>
`;

const DATA_EXTRACTION_RULES = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
    <include domain="sharedpref" path="." />
    <exclude domain="sharedpref" path="SecureStore" />
    <exclude domain="sharedpref" path="na_pivo_wearable_bridge_v1.xml" />
  </cloud-backup>
  <device-transfer>
    <include domain="sharedpref" path="." />
    <exclude domain="sharedpref" path="SecureStore" />
    <exclude domain="sharedpref" path="na_pivo_wearable_bridge_v1.xml" />
  </device-transfer>
</data-extraction-rules>
`;

module.exports = function withWearableBackupRules(config) {
  return withDangerousMod(config, [
    'android',
    async (androidConfig) => {
      const xmlDirectory = path.join(
        androidConfig.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'xml',
      );
      await fs.mkdir(xmlDirectory, { recursive: true });
      await Promise.all([
        fs.writeFile(
          path.join(xmlDirectory, 'secure_store_backup_rules.xml'),
          LEGACY_BACKUP_RULES,
          'utf8',
        ),
        fs.writeFile(
          path.join(xmlDirectory, 'secure_store_data_extraction_rules.xml'),
          DATA_EXTRACTION_RULES,
          'utf8',
        ),
      ]);
      return androidConfig;
    },
  ]);
};
