// Room naming rules for the campus: two buildings, "C" and "Cx".
// Every room id is stored as  C-102  or  Cx-304  no matter how it was typed or read
// ("room c 102", "CX304", "Cx - 304", "সি-১০২" ...).

const BN = '০১২৩৪৫৬৭৮৯';
const enDigits = (s) => String(s).replace(/[০-৯]/g, (d) => String(BN.indexOf(d)));

function normRoom(value) {
  if (value === null || value === undefined) return '';
  let s = enDigits(String(value)).trim().replace(/^room\s*/i, '').replace(/^রুম\s*/, '');
  s = s.replace(/^সিএক্স/i, 'CX').replace(/^সি/i, 'C');
  const m = /^(c\s*x|c)\s*[-–_.]?\s*(\d{2,4})\b/i.exec(s);
  if (m) {
    const building = m[1].replace(/\s+/g, '').toLowerCase() === 'cx' ? 'Cx' : 'C';
    return `${building}-${m[2]}`;
  }
  return s.toUpperCase().replace(/\s+/g, '-').slice(0, 20); // e.g. LAB-2, keep as typed
}

function normBuilding(value) {
  if (!value) return null;
  const s = String(value).trim().replace(/^building\s*/i, '').replace(/\s+/g, '').toLowerCase();
  if (s === 'cx' || s === 'সিএক্স') return 'Cx';
  if (s === 'c' || s === 'সি') return 'C';
  return null;
}

// Building + floor from a room id: C-102 -> { building: 'C', floor: 1 }
function roomParts(id) {
  const m = /^(Cx|C)-(\d)/.exec(id || '');
  if (m) return { building: m[1], floor: Number(m[2]) };
  return { building: 'Other', floor: null };
}

module.exports = { normRoom, normBuilding, roomParts };
