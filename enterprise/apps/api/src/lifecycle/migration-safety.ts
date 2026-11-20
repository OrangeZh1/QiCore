export function assertSafeMigrationSql(sql: string) {
  // Split only outside SQL strings/identifiers. The same validated statements are
  // executed by every application migration entry, without rewriting literal data.
  const statements: string[] = [];
  let statement = '', syntax = '';
  const reject = () => { throw new Error('MANUAL_UPGRADE_REQUIRED'); };
  const finish = () => {
    if (!statement.trim()) return;
    const ddl=syntax.replace(/\bON\s+(?:DELETE|UPDATE)\s+(?:CASCADE|RESTRICT|NO\s+ACTION|SET\s+NULL)\b/gi,'');
    if (/\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT|REPLACE|MODIFY|CHANGE|RENAME|EXECUTE|PREPARE|CALL)\b/i.test(ddl)
      || !/^(CREATE\s+(?:TABLE|(?:UNIQUE\s+)?INDEX)\b|ALTER\s+TABLE\s+[^\s]+\s+ADD\s)/i.test(syntax.trim())) reject();
    statements.push(statement.trim()); statement = ''; syntax = '';
  };
  for (let i = 0; i < sql.length;) {
    const char = sql[i]!;
    if (char === "'" || char === '"' || char === '`') {
      const start = i++, quote = char; let closed = false;
      while (i < sql.length) {
        if (sql[i] === '\\' && quote !== '`') { i += 2; continue; }
        if (sql[i++] !== quote) continue;
        if (sql[i] === quote) { i++; continue; }
        closed = true; break;
      }
      if (!closed) reject();
      statement += sql.slice(start, i); syntax += ' quoted '; continue;
    }
    if (sql.startsWith('/*', i)) {
      if (sql[i + 2] === '!') reject();
      const end = sql.indexOf('*/', i + 2); if (end < 0) reject();
      statement += ' '; syntax += ' '; i = end + 2; continue;
    }
    if (char === '#' || sql.startsWith('--', i) && /[\s\x00-\x20]/.test(sql[i + 2] ?? '\n')) {
      const end = sql.indexOf('\n', i); i = end < 0 ? sql.length : end + 1;
      statement += '\n'; syntax += '\n'; continue;
    }
    if (char === ';') { finish(); i++; continue; }
    statement += char; syntax += char; i++;
  }
  finish();
  return statements;
}
