import { strToU8, zipSync } from "fflate";

type WorkbookCell = string | number | Readonly<{ date: number }> | Readonly<{ formula: string; value: number }>;

export function moneyWorkbookFixture(rows: readonly (readonly WorkbookCell[])[], options: Readonly<{ sharedStrings?: boolean; date1904?: boolean }> = {}) {
  const strings: string[] = [];
  const sheet = rows.map((row, index) => `<row r="${index + 1}">${row.map((value, column) => {
    const reference = `${columnName(column)}${index + 1}`;
    if (value === "") return "";
    if (typeof value === "number") return `<c r="${reference}"><v>${value}</v></c>`;
    if (typeof value === "object") {
      return "date" in value
        ? `<c r="${reference}" s="1"><v>${value.date}</v></c>`
        : `<c r="${reference}"><f>${escapeXml(value.formula)}</f><v>${value.value}</v></c>`;
    }
    if (options.sharedStrings) {
      const offset = strings.push(value) - 1;
      return `<c r="${reference}" t="s"><v>${offset}</v></c>`;
    }
    return `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
  }).join("")}</row>`).join("");
  const namespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const files: Record<string, Uint8Array> = {
    "xl/workbook.xml": strToU8(`<workbook xmlns="${namespace}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="${options.date1904 ? 1 : 0}"/><sheets><sheet name="Statement" sheetId="1" r:id="statement"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="statement" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet4.xml"/></Relationships>'),
    "xl/worksheets/sheet4.xml": strToU8(`<worksheet xmlns="${namespace}"><sheetData>${sheet}</sheetData></worksheet>`),
    "xl/styles.xml": strToU8(`<styleSheet xmlns="${namespace}"><numFmts><numFmt numFmtId="164" formatCode="d mmm yyyy hh:mm:ss"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>`)
  };
  if (options.sharedStrings) files["xl/sharedStrings.xml"] = strToU8(`<sst xmlns="${namespace}">${strings.map((value) => `<si><t>${escapeXml(value)}</t></si>`).join("")}</sst>`);
  return zipSync(files);
}

function columnName(index: number) {
  let value = index + 1;
  let name = "";
  while (value) { name = String.fromCharCode(65 + (value - 1) % 26) + name; value = Math.floor((value - 1) / 26); }
  return name;
}

function escapeXml(value: string) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
