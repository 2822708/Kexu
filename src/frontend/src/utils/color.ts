const PALETTE = [
  { bg: '#e7f2f8', border: '#7eacc5', text: '#205675' },
  { bg: '#e6f3ef', border: '#7cae9e', text: '#245e4e' },
  { bg: '#fff3e3', border: '#d5b17a', text: '#78501b' },
  { bg: '#efedf8', border: '#aaa0cd', text: '#584982' },
  { bg: '#fbeeed', border: '#d6a19b', text: '#8b3e37' },
  { bg: '#e5f4f4', border: '#77aeae', text: '#226061' },
  { bg: '#f0f3e6', border: '#abb883', text: '#566334' },
  { bg: '#f8edf2', border: '#c69cad', text: '#7c4059' },
]

export function courseColor(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) % 100000
  }
  return PALETTE[hash % PALETTE.length]
}
