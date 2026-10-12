import { expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import yaml from 'js-yaml'
import { parsePptdProject, renderPptdProject } from '../packages/ppt-runtime/core/lib/pptd.js'
import { runCli } from '../packages/ppt-runtime/core/lib/bin.js'

it.each(['host', 'cli'])('writes product identity into %s PPTX document metadata', async route => {
  const source = {
    entryName: 'deck.pptd',
    manifest: yaml.dump({ version: 'v2', title: 'Metadata fixture', size: [960, 540], pages: ['one.page'] }),
    pages: new Map([['one.page', yaml.dump({ elements: [{
      elementId: 'title', elementType: 'text', bounds: [50, 50, 800, 100],
      content: { text: 'Metadata fixture', fontSize: 28, fontFamily: 'Arial' }
    }] })]]),
    assets: new Map()
  }
  let bytes
  if (route === 'host') {
    bytes = (await renderPptdProject(parsePptdProject(source))).bytes
  } else {
    const directory = await mkdtemp(path.join(tmpdir(), 'ppt-metadata-'))
    try {
      await writeFile(path.join(directory, source.entryName), source.manifest)
      for (const [name, content] of source.pages) await writeFile(path.join(directory, name), content)
      let diagnostics = ''
      const output = path.join(directory, 'deck.pptx')
      const stream = { write: chunk => { diagnostics += chunk } }
      expect(await runCli(['render', directory, '-o', output, '--json'], {
        stdout: stream, stderr: stream
      }), diagnostics).toBe(0)
      bytes = await readFile(output)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
  const entries = unzipSync(bytes)
  expect(strFromU8(entries['docProps/core.xml'])).toContain('<dc:creator>APUS Reflex Harness</dc:creator>')
  expect(strFromU8(entries['docProps/app.xml'])).toContain('<Company>APUS Reflex Harness</Company>')
})
