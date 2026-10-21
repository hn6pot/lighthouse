import { expect, test } from 'claude-code/testing'
import { desktopIndex, parseDesktopIndex } from '../../hooks/sessions/desktop'
import { fakeHost } from '../helpers/fake-host'

const DIR = '/Users/me/Library/Application Support/Claude/claude-code-sessions'

test('parseDesktopIndex: the desktop id and the title of each CLI session, first title only', () => {
  const out = [
    `${DIR}/a/b/local_1.json:"sessionId":"local_1"`,
    `${DIR}/a/b/local_1.json:"cliSessionId":"cli-1"`,
    `${DIR}/a/b/local_1.json:"title":"Write the widget spec"`,
    `${DIR}/a/b/local_1.json:"title":"an artifact title, later in the file"`,
    `${DIR}/a/b/local_2.json:"sessionId":"local_2"`,
    `${DIR}/a/b/local_2.json:"cliSessionId":"cli-2"`,
  ].join('\n')
  expect(parseDesktopIndex(out)).toEqual(new Map([
    ['cli-1', { desktopId: 'local_1', title: 'Write the widget spec' }],
    ['cli-2', { desktopId: 'local_2' }],
  ]))
})

test('desktopIndex: finds the session files, reads only those three fields', async () => {
  const { host, calls } = fakeHost([
    [/^find /, { stdout: `${DIR}/a/b/local_1.json\n` }],
    [/^grep /, { stdout: `${DIR}/a/b/local_1.json:"sessionId":"local_1"\n${DIR}/a/b/local_1.json:"cliSessionId":"cli-1"\n` }],
  ])
  expect(await desktopIndex(host)).toEqual(new Map([['cli-1', { desktopId: 'local_1' }]]))
  expect(calls[0]?.line).toBe(`find ${DIR} -maxdepth 3 -name local_*.json`)
  const none = fakeHost([[/^find /, { exitCode: 1 }]])
  expect(await desktopIndex(none.host)).toEqual(new Map())
})
