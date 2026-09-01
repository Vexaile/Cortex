// Test helper (not a test file): build a minimal, valid multi-page PDF with
// correct xref offsets, so the PDF adapter has real content to parse without an
// external sample. `pages` is an array of pages, each an array of text lines.
export function makePdf(pages: string[][]): Buffer {
  const enc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  let n = 3
  const pageDefs: { pageNum: number; contentNum: number; stream: string }[] = []
  const pageObjNums: number[] = []
  for (const lines of pages) {
    const pageNum = n++
    const contentNum = n++
    pageObjNums.push(pageNum)
    let y = 720
    let stream = 'BT /F1 14 Tf '
    for (const ln of lines) {
      stream += `1 0 0 1 72 ${y} Tm (${enc(ln)}) Tj `
      y -= 20
    }
    stream += 'ET'
    pageDefs.push({ pageNum, contentNum, stream })
  }
  const fontNum = n++
  const parts: string[] = []
  parts.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`)
  parts.push(`2 0 obj\n<< /Type /Pages /Kids [${pageObjNums.map((p) => `${p} 0 R`).join(' ')}] /Count ${pageObjNums.length} >>\nendobj\n`)
  for (const p of pageDefs) {
    parts.push(
      `${p.pageNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${p.contentNum} 0 R /Resources << /Font << /F1 ${fontNum} 0 R >> >> >>\nendobj\n`
    )
    parts.push(`${p.contentNum} 0 obj\n<< /Length ${p.stream.length} >>\nstream\n${p.stream}\nendstream\nendobj\n`)
  }
  parts.push(`${fontNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`)
  const header = '%PDF-1.4\n'
  let body = ''
  const offsets: number[] = []
  let pos = header.length
  for (const part of parts) {
    offsets.push(pos)
    body += part
    pos += Buffer.byteLength(part, 'latin1')
  }
  const xrefStart = header.length + Buffer.byteLength(body, 'latin1')
  const count = parts.length + 1
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`
  const trailer = `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  return Buffer.from(header + body + xref + trailer, 'latin1')
}
