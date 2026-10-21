// POSIX paths without Node: the module has no access to `path`.

export function join(base: string, path: string, home: string): string {
  const absolute = path.startsWith('~/') ? home + path.slice(1) : path.startsWith('/') ? path : `${base}/${path}`
  const parts: string[] = []
  for (const part of absolute.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return '/' + parts.join('/')
}

export function parent(path: string): string {
  const cut = path.replace(/\/+$/, '').lastIndexOf('/')
  return cut <= 0 ? '/' : path.slice(0, cut)
}
