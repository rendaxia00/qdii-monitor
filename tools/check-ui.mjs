#!/usr/bin/env node
/**
 * UI 静态一致性检查：
 *  1) app.js 中 $("#id") 引用的每个 id 必须在 index.html 中存在
 *  2) styles.css 中定义的类名与 app.js 使用的类名对齐（提示未样式化的类）
 *  3) 语法检查：用动态 import 确保 app.js 可解析（在无 DOM 环境仅解析，不执行）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(ROOT, 'public');
const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(pub, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(pub, 'styles.css'), 'utf8');

let fail = 0;
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

console.log('=== 1. DOM id 引用检查 ===');
const refs = new Set([...js.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]));
for (const r of refs) {
  const ok = ids.has(r);
  if (!ok) fail++;
  console.log(`  ${ok ? 'OK  ' : 'MISS'} #${r}`);
}
console.log(`  html 中定义的 id 共 ${ids.size} 个，js 引用 ${refs.size} 个`);
const unused = [...ids].filter((i) => !refs.has(i));
if (unused.length) console.log(`  未被 js 引用: ${unused.join(', ')}`);

console.log('\n=== 2. 关键类名样式检查 ===');
const jsClasses = new Set(
  [...js.matchAll(/el\('[a-z]+',\s*'([^']+)'/g)]
    .flatMap((m) => m[1].split(/\s+/))
    .filter(Boolean)
);
const jsClasses2 = [...js.matchAll(/classList\.add\('([^']+)'\)/g)].map((m) => m[1]);
for (const c of [...jsClasses, ...jsClasses2]) {
  if (c.includes('$') || c.includes('{')) continue;
  const ok = css.includes(`.${c}`);
  if (!ok) console.log(`  未定义样式: .${c}`);
}

console.log('\n=== 3. app.js 语法检查 ===');
try {
  // 仅解析，不执行（用 Function 构造器做语法校验）
  new Function(js.replace(/^import .*$/gm, '').replace(/^export .*$/gm, ''));
  console.log('  OK  语法正确');
} catch (e) {
  fail++;
  console.log('  FAIL ' + e.message);
}

console.log('\n=== 4. HTML 结构检查 ===');
const checks = [
  ['<!doctype html>', /<!doctype html>/i.test(html)],
  ['viewport meta', /name="viewport"/.test(html)],
  ['stylesheet 引入', /styles\.css/.test(html)],
  ['script module 引入', /app\.js/.test(html)],
  ['表格 8 列', (html.match(/<th class="col-/g) || []).length === 8],
];
for (const [n, ok] of checks) {
  if (!ok) fail++;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${n}`);
}

console.log(`\n结果: ${fail === 0 ? '全部通过' : fail + ' 项需处理'}`);
process.exitCode = fail ? 1 : 0;
