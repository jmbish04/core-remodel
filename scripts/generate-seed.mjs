import fs from 'fs';
import crypto from 'crypto';

const data = JSON.parse(fs.readFileSync('../image_reviews.json', 'utf8'));

let sql = `
-- Auto-generated seed file from image_reviews.json
-- Deletes existing records to prevent conflicts (optional, but safe for initial seed)
DELETE FROM image_reviews;

`;

for (const [key, val] of Object.entries(data.images)) {
  const filename = val.filename.replace(/'/g, "''");
  const path = val.path.replace(/'/g, "''");
  const room = val.room ? val.room.replace(/'/g, "''") : "unassigned";
  const note = val.note ? val.note.replace(/'/g, "''") : "";
  const igAccount = val.igAccount ? val.igAccount.replace(/'/g, "''") : "";
  const visibleCaption = val.visibleCaption ? val.visibleCaption.replace(/'/g, "''") : "";
  const tagsStr = val.tags ? JSON.stringify(val.tags).replace(/'/g, "''") : "[]";
  
  // Create an INSERT statement
  sql += `INSERT INTO image_reviews (id, filename, path, room, note, ig_account, visible_caption, tags, updated_at) VALUES ('${crypto.randomUUID()}', '${filename}', '${path}', '${room}', '${note}', '${igAccount}', '${visibleCaption}', '${tagsStr}', unixepoch());\n`;
}

fs.writeFileSync('seed.sql', sql);
console.log('Generated seed.sql with ' + Object.keys(data.images).length + ' records');
