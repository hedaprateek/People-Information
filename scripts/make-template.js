#!/usr/bin/env node
/**
 * Writes template/directory-template.xlsx — a blank directory with every
 * supported sheet, the right column headings, a couple of example rows, and
 * the Hindi entries already wired up.
 *
 *   node scripts/make-template.js
 *
 * The generated file is committed, so normally you just download it. Re-run
 * this only if the template itself needs changing.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

/* SheetJS is fetched into a gitignored cache — same as the test does. */
const CACHE = path.join(__dirname, "..", "test", ".cache");
const LIB = path.join(CACHE, "xlsx.js");
if (!fs.existsSync(LIB)) {
  fs.mkdirSync(CACHE, { recursive: true });
  console.log("fetching SheetJS (once)…");
  execFileSync("curl", ["-sSL", "-o", LIB,
    "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"], { stdio: "inherit" });
}
const X = require(LIB);

/* Every cell is written as text. Excel otherwise turns +91 98… into a number
   and eats the leading zero on a landline. */
function sheet(rows, widths) {
  const ws = X.utils.json_to_sheet(rows);
  const rng = X.utils.decode_range(ws["!ref"]);
  for (let R = rng.s.r; R <= rng.e.r; R++)
    for (let C = rng.s.c; C <= rng.e.c; C++) {
      const c = ws[X.utils.encode_cell({ r: R, c: C })];
      if (c && c.v != null) { c.t = "s"; c.v = String(c.v); }
    }
  ws["!cols"] = widths
    ? widths.map(w => ({ wch: w }))
    : Object.keys(rows[0] || {}).map(k =>
        ({ wch: Math.max(k.length + 2, ...rows.map(r => String(r[k] ?? "").length + 2), 12) }));
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  return ws;
}

/* ─────────────────────────── About ─────────────────────────── */
const about = [
  ["Society Name",        "Your Society Name",                       "सोसाइटी का नाम — बड़े शीर्षक में दिखेगा"],
  ["Tagline",             "A Co-operative Housing Society",          "उपशीर्षक"],
  ["Address",             "Street address",                          "पता"],
  ["City",                "City",                                    "शहर"],
  ["Pincode",             "000000",                                  "पिन कोड"],
  ["Registration No",     "",                                        "पंजीकरण संख्या — नीचे फुटर में"],
  ["Logo",                "",                                        "वैकल्पिक: लोगो की इमेज URL"],
  ["Confidential Notice", "Please do not forward this link or share these details with anyone outside the society.",
                          "ऊपर दिखने वाली चेतावनी (अंग्रेज़ी)"],
  ["Confidential HI",     "कृपया यह लिंक या विवरण सोसाइटी के बाहर किसी के साथ साझा न करें।",
                          "वही चेतावनी हिंदी में"],
  ["Hindi: Committee",       "समिति",              "हिंदी में अनुभाग का नाम"],
  ["Hindi: Emergency",       "आपातकालीन संपर्क",    "हिंदी में अनुभाग का नाम"],
  ["Hindi: Services & Help", "सेवाएँ और सहायता",     "हिंदी में अनुभाग का नाम"],
  ["Hindi: Residents",       "निवासी",              "हिंदी में अनुभाग का नाम"],
  ["Hindi: Documents",       "दस्तावेज़",            "हिंदी में अनुभाग का नाम"],
  ["Note: Services & Help",
   "These contacts are collected from fellow residents. The society has not verified or endorsed any of them. Please check credentials and agree charges before engaging anyone — you do so at your own risk.",
   "उस अनुभाग के नीचे दिखने वाली चेतावनी"],
  ["Note HI: Services & Help",
   "ये संपर्क अन्य निवासियों द्वारा दिए गए हैं। सोसाइटी ने इनकी जाँच नहीं की है। काम शुरू कराने से पहले कृपया स्वयं पुष्टि करें और शुल्क तय कर लें — जोखिम आपका अपना होगा।",
   "वही चेतावनी हिंदी में"],
].map(([f, v, h]) => ({ "Field": f, "Value": v, "What it does / यह क्या करता है": h }));

/* ─────────────────────── people & services ─────────────────── */
const committee = [
  { Name:"Example Name", Role:"Chairman",       Flat:"A-402", Phone:"+91 98200 11223", Email:"name@example.com" },
  { Name:"उदाहरण नाम",    Role:"Hon. Secretary", Flat:"B-105", Phone:"+91 98200 11224", Email:"" },
];

const emergency = [
  { Service:"Ambulance",     Contact:"",            Phone:"102",             Notes:"Toll free, 24x7" },
  { Service:"Police",        Contact:"",            Phone:"100",             Notes:"" },
  { Service:"Fire Brigade",  Contact:"",            Phone:"101",             Notes:"" },
  { Service:"Security Gate", Contact:"Example Name", Phone:"+91 90040 55501", Notes:"Main gate, 24x7" },
];

const services = [
  { Name:"Example Plumber", Role:"Plumber", Charges:"₹100 / visit",
    Timings:"9 AM – 7 PM", Phone:"+91 90040 55511", Notes:"Parts charged separately" },
  { Name:"उदाहरण मेड",      Role:"Maid",    Charges:"₹50 / visit",
    Timings:"7 AM – 11 AM", Phone:"+91 90210 33001", Notes:"झाड़ू, पोछा, बर्तन" },
];

const residents = [
  { Name:"Example Owner", Block:"A", Flat:"A-101", Phone:"+91 98330 40011",
    Email:"owner@example.com", Type:"Owner",
    "Owner Name":"", "Owner Phone":"", "Owner Address":"" },
  { Name:"Example Tenant", Block:"B", Flat:"B-403", Phone:"+91 98330 40017",
    Email:"", Type:"Tenant",
    "Owner Name":"Flat Owner Name", "Owner Phone":"+91 98200 44002",
    "Owner Address":"Owner's address, city" },
];

const documents = [
  { Title:"Society Bye-Laws", Category:"Governance",
    File:"materials/Society_Bye_Laws.pdf", Updated:"2026-01-01",
    Notes:"Upload the file in the admin panel; it fills this row for you" },
];

/* ───────────────────────── instructions ────────────────────── */
// Leading underscore: this sheet is never shown on the website.
const readme = [
  ["Sheets", "Every sheet tab becomes a section on the website, in this order. Add a tab, get a section.",
             "हर शीट वेबसाइट पर एक अनुभाग बन जाती है। नई शीट जोड़ें, नया अनुभाग बनेगा।"],
  ["About", "Not a section — it fills the page header and holds the settings below.",
            "यह अनुभाग नहीं है — इससे पेज का शीर्षक और सेटिंग्स बनती हैं।"],
  ["Emergency", "Any tab whose name contains \"emerg\" shows in red in the sidebar.",
                "जिस शीट के नाम में \"emerg\" हो, वह साइडबार में लाल रंग में दिखेगी।"],
  ["Documents", "Any tab with a File column becomes the documents panel.",
                "जिस शीट में File कॉलम हो, वह दस्तावेज़ पैनल बन जाएगी।"],
  ["Private data", "A sheet or column starting with _ is stored but never shown on the site. Use it for dates of birth.",
                   "_ से शुरू होने वाली शीट या कॉलम वेबसाइट पर कभी नहीं दिखेंगे। जन्मतिथि आदि के लिए इसका उपयोग करें।"],
  ["Name column", "Name, Service, Person or Title becomes the card heading.",
                  "Name, Service, Person या Title कार्ड का शीर्षक बनता है।"],
  ["Phone column", "Phone, Mobile, Contact No or Cell becomes a call button.",
                   "Phone, Mobile, Contact No या Cell कॉल बटन बन जाता है।"],
  ["Role column", "Role, Designation, Post or Type shows as the small label.",
                  "Role, Designation, Post या Type छोटे लेबल के रूप में दिखता है।"],
  ["Charges column", "Charges, Rate, Fee or Price shows as a gold badge.",
                     "Charges, Rate, Fee या Price सुनहरे बैज में दिखता है।"],
  ["Owner columns", "Owner Name / Owner Phone / Owner Address show behind an \"Owner details\" button, for tenanted flats.",
                    "किरायेदार वाले फ्लैट के लिए मकान मालिक का विवरण एक बटन के पीछे दिखता है।"],
  ["Phone format", "Format phone columns as TEXT in Excel, or it will drop the + and leading zeros.",
                   "फ़ोन कॉलम को Excel में TEXT फ़ॉर्मैट रखें, वरना + और शुरुआती शून्य हट जाएँगे।"],
  ["Hindi", "Add \"Hindi: <sheet name>\" rows in About to translate section names. Values you type are shown as-is, so Hindi names work anywhere.",
            "अनुभागों के हिंदी नाम About शीट में \"Hindi: <नाम>\" पंक्ति से जोड़ें। आपके लिखे मान जैसे हैं वैसे दिखते हैं।"],
  ["Examples", "Delete the example rows before publishing.",
               "प्रकाशित करने से पहले उदाहरण पंक्तियाँ हटा दें।"],
].map(([a, b, c]) => ({ "Topic": a, "English": b, "हिंदी": c }));

/* ───────────────────────────── build ───────────────────────── */
const wb = X.utils.book_new();
X.utils.book_append_sheet(wb, sheet(about, [26, 62, 46]),        "About");
X.utils.book_append_sheet(wb, sheet(committee),                  "Committee");
X.utils.book_append_sheet(wb, sheet(emergency),                  "Emergency");
X.utils.book_append_sheet(wb, sheet(services),                   "Services & Help");
X.utils.book_append_sheet(wb, sheet(residents),                  "Residents");
X.utils.book_append_sheet(wb, sheet(documents),                  "Documents");
X.utils.book_append_sheet(wb, sheet(readme, [16, 70, 70]),       "_Read me");

const outDir = path.join(__dirname, "..", "template");
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "directory-template.xlsx");
fs.writeFileSync(out, X.write(wb, { type: "buffer", bookType: "xlsx", compression: true }));

console.log("wrote " + out);
console.log("sheets: " + wb.SheetNames.join(", "));
