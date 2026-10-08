import re

with open('scratch/document.xml', 'r', encoding='utf-8') as f:
    xml = f.read()

# Fix document_notes
xml = re.sub(r'\{\{docu[^}]*?otes\}\}', '{{document_notes}}', xml)

# Fix business_name
xml = re.sub(r'\{\{busi[^}]*?name\}\}', '{{business_name}}', xml)

# Fix delivery_terms
xml = re.sub(r'\{\{deliv[^}]*?erms\}\}', '{{delivery_terms}}', xml)

# Inject loop tags around the line item row
if '{{item_sku}}' in xml and '{#line_items}' not in xml:
    # Find the row containing {{item_sku}}
    # We want the <w:tr> that encloses it.
    match = re.search(r'<w:tr[\s>].*?\{\{item_sku\}\}.*?</w:tr>', xml, flags=re.DOTALL)
    if match:
        row_xml = match.group(0)
        # We must only match ONE row, so let's be careful.
        # Actually, let's use a non-greedy match that doesn't contain <w:tr> inside it
        match2 = re.search(r'<w:tr( [^>]*)?>(?:(?!<w:tr).)*?\{\{item_sku\}\}.*?</w:tr>', xml, flags=re.DOTALL)
        if match2:
            row_xml = match2.group(0)
            new_row_xml = '<w:tr><w:tc><w:p><w:r><w:t>{#line_items}</w:t></w:r></w:p></w:tc></w:tr>' + row_xml + '<w:tr><w:tc><w:p><w:r><w:t>{/line_items}</w:t></w:r></w:p></w:tc></w:tr>'
            xml = xml.replace(row_xml, new_row_xml)

# Remove the text
xml = re.sub(r'Repeat the marked line-item row for every element in \{\{line_items\}\}.', '', xml)

with open('scratch/document_fixed.xml', 'w', encoding='utf-8') as f:
    f.write(xml)
