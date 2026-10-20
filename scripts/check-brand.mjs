import { execFileSync } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
// The former identifiers are byte-defined so the obsolete name is not reintroduced
// into current source just to detect it. Original author attribution is retained.
const formerPrefix = String.fromCharCode(116, 97, 110, 103, 101, 110, 116)
const formerRepo = String.fromCharCode(84, 105, 109, 101, 116, 97, 98, 108, 101)
const obsolete = new RegExp(
  `${formerPrefix}|github\\.com/2822708/${formerRepo}(?:[/.#?]|$)|${String.fromCodePoint(0x5927, 0x5207)}|${String.fromCodePoint(0x8bfe, 0x5e8f)}`,
  'i',
)
const originalAuthor = new RegExp(`${formerPrefix}0712`, 'gi')
const names = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))]
const failures = []
let checked = 0
for (const name of names) {
  const absolute = path.join(root, name)
  const info = await stat(absolute).catch(() => null)
  if (!info?.isFile()) continue
  if (obsolete.test(name.replace(originalAuthor, 'original-author'))) failures.push(`${name}: obsolete product path`)
  const bytes = await readFile(absolute)
  if (bytes.includes(0)) continue // Binary releases and visual evidence are checked separately.
  const text = bytes.toString('utf8').replace(originalAuthor, 'original-author')
  checked++
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (obsolete.test(line)) failures.push(`${name}:${index + 1}: obsolete product name`)
  }
}
if (failures.length) {
  process.stderr.write(`${failures.join('\n')}\n`)
  process.exitCode = 1
} else console.log(`PASS: Kexu product naming across ${checked} tracked/current text files.`)
