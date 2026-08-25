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


/* ─────────────────────── use-case presets ───────────────────────
   Nothing here is special to the app: a preset is just a different set of
   sheets and a different theme. Any of them can be edited afterwards, and a
   sheet added later becomes a section with no code change. */

const PRESETS = {
  society: {
    theme: 'navy',
    title: 'Your Society Name',
    tagline: 'A Co-operative Housing Society',
    sheets: ['Committee', 'Emergency', 'Services & Help', 'Residents', 'Documents', '_Private']
  },
  school: {
    theme: 'ocean',
    title: 'Your School or Coaching Centre',
    tagline: 'Staff, classes and contacts',
    sheets: ['Staff', 'Emergency', 'Classes', 'Parents', 'Documents']
  },
  club: {
    theme: 'forest',
    title: 'Your Club or Association',
    tagline: 'Members and office bearers',
    sheets: ['Office Bearers', 'Emergency', 'Members', 'Events', 'Documents']
  },
  team: {
    theme: 'slate',
    title: 'Your Team',
    tagline: 'Who does what, and who to call',
    sheets: ['Team', 'On Call', 'Vendors', 'Documents']
  },
  temple: {
    theme: 'sunset',
    title: 'Your Temple or Community Centre',
    tagline: 'Timings, volunteers and contacts',
    sheets: ['Committee', 'Emergency', 'Timings', 'Volunteers', 'Documents']
  },
  alumni: {
    theme: 'plum',
    title: 'Your Batch or Alumni Group',
    tagline: 'Stay in touch',
    sheets: ['Coordinators', 'Members', 'Events', 'Documents']
  }
};

/** Column sets per sheet. A sheet not listed falls back to name + phone. */
const COLUMNS = {
  'Committee':      ['Name', 'Role', 'Flat', 'Phone', 'Email'],
  'Office Bearers': ['Name', 'Role', 'Phone', 'Email'],
  'Coordinators':   ['Name', 'Role', 'City', 'Phone', 'Email'],
  'Staff':          ['Name', 'Role', 'Subject', 'Phone', 'Email'],
  'Team':           ['Name', 'Role', 'Team', 'Phone', 'Email'],
  'Emergency':      ['Service', 'Contact', 'Phone', 'Notes'],
  'On Call':        ['Service', 'Contact', 'Phone', 'Notes'],
  'Services & Help':['Name', 'Role', 'Charges', 'Timings', 'Phone', 'Notes'],
  'Vendors':        ['Name', 'Role', 'Charges', 'Phone', 'Notes'],
  // "Unit Type" separates a flat from a row house that share a wing and number.
  'Residents':      ['Name', 'Block', 'Flat', 'Unit Type', 'Phone', 'Email', 'Type', 'Blood Group',
                     'Emergency Contact', 'Vehicle No', 'Vehicle Type', 'Parking Slot',
                     'Profession', 'Language', 'Occupants', 'Pets',
                     'Owner Name', 'Owner Phone', 'Owner Address'],
  'Members':        ['Name', 'Role', 'City', 'Phone', 'Email'],
  'Parents':        ['Name', 'Student', 'Class', 'Phone', 'Email'],
  'Classes':        ['Name', 'Role', 'Timings', 'Charges', 'Phone', 'Notes'],
  'Timings':        ['Name', 'Role', 'Timings', 'Notes'],
  'Volunteers':     ['Name', 'Role', 'Timings', 'Phone'],
  'Events':         ['Name', 'Role', 'Timings', 'Notes', 'Phone'],
  'Documents':      ['Title', 'Category', 'File', 'Updated', 'Notes'],
  '_Private':       ['Flat', 'Person', 'Relation', 'DOB', 'Medical Notes',
                     'Elderly or alone', 'Lease Ends', 'Police Verification']
};


/** Section names in Hindi, so a preset ships bilingual out of the box. */
const HINDI = {
  "Committee": "समिति", "Office Bearers": "पदाधिकारी", "Coordinators": "समन्वयक",
  "Emergency": "आपातकालीन संपर्क", "On Call": "आपातकालीन ड्यूटी",
  "Services & Help": "सेवाएँ और सहायता", "Vendors": "विक्रेता",
  "Residents": "निवासी", "Members": "सदस्य", "Staff": "स्टाफ",
  "Classes": "कक्षाएँ", "Parents": "अभिभावक", "Events": "कार्यक्रम",
  "Volunteers": "स्वयंसेवक", "Timings": "समय", "Team": "टीम",
  "Documents": "दस्तावेज़"
};

/** A believable value for a column, so every preset gets usable examples
 *  without hand-writing rows for each one. */
function sample(col, i) {
  const c = col.toLowerCase();
  if (/^name$|^title$/.test(c))      return i ? "उदाहरण नाम" : "Example Name";
  if (/^service$/.test(c))           return i ? "Police" : "Ambulance";
  if (/^contact$/.test(c))           return i ? "" : "Example Name";
  if (/phone|mobile/.test(c))        return i ? "+91 98200 11224" : "+91 98200 11223";
  if (/mail/.test(c))                return i ? "" : "name@example.com";
  if (/^role$|^type$/.test(c))       return i ? "Member" : "Lead";
  if (/charge|fee|rate/.test(c))     return i ? "₹50 / visit" : "₹100 / visit";
  if (/timing|time/.test(c))         return i ? "7 AM – 11 AM" : "9 AM – 6 PM";
  if (/note/.test(c))                return i ? "" : "Anything worth knowing";
  if (/^file$/.test(c))              return "materials/example.pdf";
  if (/updated/.test(c))             return new Date().toISOString().slice(0, 10);
  if (/category/.test(c))            return "General";
  if (/city/.test(c))                return i ? "Pune" : "Mumbai";
  if (/subject|class|student|team/.test(c)) return i ? "" : "Example";
  if (/block|wing|tower/.test(c))    return i ? "B" : "A";
  if (/flat|unit|room/.test(c))      return i ? "B-105" : "A-402";
  if (/^owner /.test(c))             return "";
  return "";
}

function rowsFor(name) {
  const cols = COLUMNS[name] || ["Name", "Phone"];
  return [0, 1].map(i => {
    const o = {};
    cols.forEach(c => { o[c] = sample(c, i); });
    return o;
  });
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
  { Name:"Example Owner", Block:"A", Flat:"A-101", "Unit Type":"Flat",
    Phone:"+91 98330 40011",
    Email:"owner@example.com", Type:"Owner", "Blood Group":"O+",
    "Emergency Contact":"Relative name, +91 98220 11111",
    "Vehicle No":"MH-09-AB-1234", "Vehicle Type":"Car", "Parking Slot":"P-12",
    Profession:"Doctor", Language:"Marathi", Occupants:"4", Pets:"",
    "Owner Name":"", "Owner Phone":"", "Owner Address":"" },

  // A tenanted flat: the owner columns are what produce the Owner details
  // button on the card. Leave them blank for owner-occupied flats.
  { Name:"Example Tenant", Block:"B", Flat:"B-403", "Unit Type":"Flat",
    Phone:"+91 98330 40017",
    Email:"", Type:"Tenant", "Blood Group":"A+",
    "Emergency Contact":"", "Vehicle No":"MH-09-CD-5678", "Vehicle Type":"Two-wheeler",
    "Parking Slot":"P-31", Profession:"Teacher", Language:"Hindi", Occupants:"2", Pets:"1 cat",
    "Owner Name":"Flat Owner Name", "Owner Phone":"+91 98200 44002",
    "Owner Address":"Owner's address, city" },

  // Same wing, same number, different home. Without "Unit Type" this row and
  // the flat below it are indistinguishable on the page and would be issued
  // one access code between them.
  { Name:"Example Row House", Block:"B", Flat:"B-11", "Unit Type":"Row House",
    Phone:"+91 98330 40021",
    Email:"", Type:"Owner", "Blood Group":"B+",
    "Emergency Contact":"", "Vehicle No":"", "Vehicle Type":"", "Parking Slot":"",
    Profession:"", Language:"Marathi", Occupants:"5", Pets:"",
    "Owner Name":"", "Owner Phone":"", "Owner Address":"" },
];

// Never published: the leading underscore keeps the whole sheet off the page.
const privateRows = [
  { Flat:"A-101", Person:"Example Owner", Relation:"Primary", DOB:"1979-04-12",
    "Medical Notes":"Diabetic", "Elderly or alone":"No", "Lease Ends":"",
    "Police Verification":"" },
  { Flat:"B-403", Person:"Example Tenant", Relation:"Primary", DOB:"1990-08-30",
    "Medical Notes":"", "Elderly or alone":"No", "Lease Ends":"2027-03-31",
    "Police Verification":"Done 2026-02-10" },
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
  ["Blood group", "Shown as a red badge on the card. Use a dropdown in your form so you do not collect \"o positive\" and \"O +ve\".",
                  "कार्ड पर लाल बैज में दिखता है। फ़ॉर्म में ड्रॉपडाउन रखें।"],
  ["Optional fields", "The first two extra columns show on the card; the rest fold behind a More details button. Search still finds them and opens the card.",
                      "पहले दो अतिरिक्त कॉलम कार्ड पर दिखते हैं, बाक़ी \"More details\" के पीछे। खोज उन्हें भी ढूँढ लेती है।"],
  ["Owner columns", "Fill Owner Name / Owner Phone / Owner Address only for tenanted flats. They appear behind an Owner details button; leave blank and nothing is shown.",
                    "किरायेदार वाले फ्लैट के लिए ही भरें। खाली छोड़ने पर कुछ नहीं दिखेगा।"],
  ["_Private sheet", "Dates of birth, medical notes, lease dates and police verification live here. The leading underscore keeps the sheet off the website entirely.",
                     "जन्मतिथि, चिकित्सा जानकारी आदि यहाँ रखें। यह शीट वेबसाइट पर कभी नहीं दिखती।"],
  ["Examples", "Delete the example rows before publishing.",
               "प्रकाशित करने से पहले उदाहरण पंक्तियाँ हटा दें।"],
].map(([a, b, c]) => ({ "Topic": a, "English": b, "हिंदी": c }));

/* ───────────────────────────── build ───────────────────────── */

const argIdx = process.argv.indexOf('--preset');
const presetName = (argIdx > -1 && process.argv[argIdx + 1]) || 'society';
const cfg = PRESETS[presetName];
if (!cfg) {
  console.error('Unknown preset: ' + presetName +
    '\nTry one of: ' + Object.keys(PRESETS).join(', '));
  process.exit(1);
}

// The society preset keeps its hand-written examples; the rest are generated
// from the column sets, which is why adding a preset costs three lines.
const CURATED = { 'Committee': committee, 'Emergency': emergency,
                  'Services & Help': services, 'Residents': residents,
                  'Documents': documents, '_Private': privateRows };

const aboutRows = about.slice();
function setAbout(field, value) {
  const hit = aboutRows.find(r2 => r2['Field'] === field);
  if (hit) hit['Value'] = value;
}
setAbout('Society Name', cfg.title);
setAbout('Tagline', cfg.tagline);

// drop the society-only Hindi and note rows, then add the preset's own
const keep = aboutRows.filter(r2 => !/^Hindi: |^Note(?: HI)?: /.test(r2['Field']));
keep.push({ 'Field': 'Theme', 'Value': cfg.theme,
            'What it does / यह क्या करता है':
            'navy, forest, plum, slate, sunset, ocean, paper' });
cfg.sheets.forEach(s => {
  if (HINDI[s]) keep.push({ 'Field': 'Hindi: ' + s, 'Value': HINDI[s],
    'What it does / यह क्या करता है': 'हिंदी में अनुभाग का नाम' });
});
if (cfg.sheets.indexOf('Services & Help') > -1) {
  keep.push({ 'Field': 'Note: Services & Help',
    'Value': 'These contacts are collected from members. They have not been verified or endorsed. Please check credentials and agree charges before engaging anyone — you do so at your own risk.',
    'What it does / यह क्या करता है': 'उस अनुभाग के नीचे दिखने वाली चेतावनी' });
}

const wb = X.utils.book_new();
X.utils.book_append_sheet(wb, sheet(keep, [26, 62, 46]), 'About');
cfg.sheets.forEach(name => {
  const rows = (presetName === 'society' && CURATED[name]) || rowsFor(name);
  X.utils.book_append_sheet(wb, sheet(rows), name.slice(0, 31));
});
X.utils.book_append_sheet(wb, sheet(readme, [16, 70, 70]), '_Read me');

const outDir = path.join(__dirname, '..', 'template');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir,
  presetName === 'society' ? 'directory-template.xlsx' : presetName + '-template.xlsx');
fs.writeFileSync(out, X.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }));

console.log('wrote ' + out);
console.log('preset: ' + presetName + '   theme: ' + cfg.theme);
console.log('sheets: ' + wb.SheetNames.join(', '));