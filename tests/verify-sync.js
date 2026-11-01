const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

const pairedFiles = [
  'admin.html',
  'teacher.html',
  'student.html',
  'coordinator.html',
  'shared-nav.js',
  'shared-nav.css',
  'menu-config.js'
];

let hasMismatch = false;

pairedFiles.forEach(file => {
  const rootPath = path.join(projectRoot, file);
  const publicPath = path.join(projectRoot, 'public', file);

  if (!fs.existsSync(rootPath)) {
    console.error(`[FAIL] Root file missing: ${rootPath}`);
    hasMismatch = true;
    return;
  }
  if (!fs.existsSync(publicPath)) {
    console.error(`[FAIL] Public file missing: ${publicPath}`);
    hasMismatch = true;
    return;
  }

  const rootBuf = fs.readFileSync(rootPath);
  const publicBuf = fs.readFileSync(publicPath);

  if (!rootBuf.equals(publicBuf)) {
    console.error(`[FAIL] Mismatch between ${rootPath} and ${publicPath}`);
    hasMismatch = true;
  } else {
    console.log(`[PASS] Verified identical: ${file}`);
  }
});

if (hasMismatch) {
  console.error('\nSync verification FAILED! Drift detected between root and public/ copies.');
  process.exit(1);
} else {
  console.log('\nAll paired files are 100% byte-for-byte identical. No drift detected.');
  process.exit(0);
}
