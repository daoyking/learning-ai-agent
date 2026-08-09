import docx
import pdfplumber as pdf_open
import sys

# --- Read DOCX (2022 resume) ---
docx_path = "/Users/jindy/WorkBuddy/learning-AI/resume-sources/金道洋的求职简历2022.docx"
print("="*70)
print("2022 DOCX RESUME CONTENT")
print("="*70)

doc = docx.Document(docx_path)

def iter_block_items(parent):
    from docx.document import Document
    from docx.oxml.table import CT_Tbl
    from docx.oxml.text.paragraph import CT_P
    from docx.table import Table, _Cell
    from docx.text.paragraph import Paragraph
    body = parent.element.body
    for child in body.iterchildren():
        if isinstance(child, CT_P):
            yield Paragraph(child, parent)
        elif isinstance(child, CT_Tbl):
            yield Table(child, parent)

from docx.table import Table
from docx.text.paragraph import Paragraph

for block in iter_block_items(doc):
    if isinstance(block, Paragraph):
        text = block.text
        if text.strip():
            style = block.style.name if block.style else ""
            print(f"[P|{style}] {text}")
    elif isinstance(block, Table):
        print("  --- TABLE ---")
        for row in block.rows:
            cells = [c.text.strip() for c in row.cells]
            print("   | " + " | ".join(cells))
        print("  --- END TABLE ---")

print()
print("="*70)
print("2026 PDF RESUME CONTENT")
print("="*70)

pdf_path = "/Users/jindy/WorkBuddy/learning-AI/resume-sources/金道洋-前端开发工程师2026.pdf"
with pdf_open.open(pdf_path) as pdf:
    for i, page in enumerate(pdf.pages):
        print(f"\n----- PAGE {i+1} -----")
        txt = page.extract_text() or ""
        print(txt)
