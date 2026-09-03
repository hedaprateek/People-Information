/* Renders cards from a many-optional-fields row and reports the card's shape. */
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..") + "/";

// index.html is stored with CRLF; normalise so the extraction patterns match.
const html = fs.readFileSync(ROOT + "index.html", "utf8").split("\r\n").join("\n");

class N {
  constructor(t){ this.tag=t; this.children=[]; this.attrs={}; this._text=""; this.className="";
                  this._on={}; }
  appendChild(c){ this.children.push(c); return c; }
  setAttribute(k,v){ this.attrs[k]=v; }
  addEventListener(ev,fn){ this._on[ev]=fn; }
  focus(){}
  get classList(){ const self=this; return {
    add(c){ self.className=(self.className+" "+c).trim(); },
    remove(c){ self.className=self.className.split(/\s+/).filter(x=>x&&x!==c).join(" "); },
    contains(c){ return self.className.split(/\s+/).includes(c); } }; }
  set href(v){ this.attrs.href=v; }
  set target(v){ this.attrs.target=v; }
  set rel(v){ this.attrs.rel=v; }
  set title(v){ this.attrs.title=v; }
  set open(v){ if (v) this.attrs.open="open"; }
  set src(v){ this.attrs.src=v; }
  set alt(v){} set loading(v){} set onerror(v){}
  set textContent(v){ this._text=String(v); this.children=[]; }
  get textContent(){ return this._text + this.children.map(c=>c.textContent||"").join(""); }
  get outer(){
    const cls = this.className ? ` class="${this.className}"` : "";
    const at = Object.entries(this.attrs).map(([k,v])=>` ${k}="${v}"`).join("");
    const kids = this.children.map(c => c.outer !== undefined ? c.outer : c.textContent).join("");
    return `<${this.tag}${cls}${at}>${this._text}${kids}</${this.tag}>`;
  }
}
globalThis.document = {
  createElement: t => new N(t),
  createElementNS: (_n,t) => new N(t),
  createTextNode: t => ({ textContent:String(t), outer:String(t) })
};
globalThis.location = { protocol:"https:", origin:"https://society.example", pathname:"/" };
let copied = null;
// Node defines navigator as a getter-only global, so it has to be replaced.
Object.defineProperty(globalThis, "navigator", {
  value: { clipboard: { writeText: v => { copied = v; return Promise.resolve(); } } },
  configurable: true
});

const grab = re => {
  const m = html.match(re);
  if (!m) { console.error("NO MATCH: " + re); process.exit(1); }
  return m[0];
};

const api = new Function([
  "var meta = {}, sectionNotes = {};",
  grab(/var P = \{[\s\S]*?\n  \};/),
  grab(/function svg\(d, stroke\)[\s\S]*?\n  \}/),
  grab(/function el\(t, c, x\)[\s\S]*?\n  \}/),
  grab(/function initials\(n\)[\s\S]*?\n  \}/),
  grab(/function isUrl\(v\)[\s\S]*?\n/),
  grab(/function tel\(v\)[\s\S]*?\n/),
  grab(/function fileCol\(cols\)[\s\S]*?\n  \}/),
  grab(/function classify\(cols\)[\s\S]*?\n    return r;\n  \}/),
  grab(/function waNum\(v\)[\s\S]*?\n  \}/),
  grab(/function shareable\(s\)[\s\S]*?\n  \}/),
  grab(/function shareText\(row, map, s, title\)[\s\S]*?\n  \}/),
  grab(/function actionRow\(row, map, s, title, full\)[\s\S]*?\n    return go;\n  \}/),
  grab(/function avatarFor\(row, map, title\)[\s\S]*?\n  \}/),
  grab(/function placeOf\(row, map\)[\s\S]*?\n  \}/),
  grab(/function openSheet\(row, map, s, title\)[\s\S]*?\n    x\.focus\(\);\n  \}/),
  grab(/function contact\(row, map, sos, term, s\)[\s\S]*?\n    return c;\n  \}/),
  'function t(k){ return {ownerDetails:"Owner details",details:"Details",close:"Close",' +
    'call:"Call",email:"Email",whatsapp:"WhatsApp",share:"Share",attachment:"Attachment"}[k] || k; }',
  'function ext(p){ var m=String(p).split("?")[0].match(/\.([a-z0-9]+)$/i); return m?m[1].toUpperCase():"FILE"; }',
  'function absUrl(p){ return p; }',
  'var sheetOpen=false;',
  grab(/function closeSheet\(\)[\s\S]*?\n  \}/),
  'function key(s){ return String(s).toLowerCase().replace(/[^a-z0-9]+/g,""); }',
  "function sectionTitle(s){ return s.title; }",
  "var lang = 'en';",
  "return { contact, classify, waNum, shareable, shareText, openSheet, closeSheet,",
  "         setMeta: m => { meta = m; }, setNotes: n => { sectionNotes = n; } };"
].join("\n"))();

const { contact, classify, waNum, shareable, shareText } = api;

const row = {
  Name:"Anil Kulkarni", Block:"A", Flat:"A-101", Phone:"+91 98330 40011",
  Email:"anil@example.com", Type:"Owner", "Blood Group":"O+",
  "Emergency Contact":"Sunil Kulkarni +91 98220 11111",
  "Vehicle No":"MH-09-AB-1234", "Parking Slot":"P-12", "Vehicle Type":"Car",
  Profession:"Paediatrician", Language:"Marathi", Occupants:"4", Pets:"1 dog"
};
const map = classify(Object.keys(row));

let fails = 0;
const chk = (l,g,e) => {
  const ok = String(g) === String(e);
  if (!ok) fails++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${l.padEnd(46)} ${String(g).slice(0,30)}`);
};

console.log("column roles");
chk("blood group detected", map.blood, "Blood Group");
chk("blood not left in the detail list", map.rest.includes("Blood Group"), false);
chk("only the real phone is a call button", map.phone.join(","), "Phone");
chk("optional fields land in the detail list", map.rest.length >= 6, true);

/* The card is the summary: who, where, and how to reach them. Everything a
   row happens to carry lives in the sheet, one tap away, so a long directory
   stays scannable. */
const out = contact(row, map, false, "").outer;

console.log("\nthe compact card");
chk("the name is on it", out.includes("Anil Kulkarni"), true);
chk("so is where they live", /class="csub"[\s\S]*?A-101/.test(out), true);
chk("blood group stays on the face", /class="blood">O\+</.test(out), true);
chk("call button", out.includes('href="tel:+919833040011"'), true);
chk("WhatsApp button", out.includes('href="https://wa.me/919833040011"'), true);
// Two buttons on the row, not four: a name and four buttons do not fit on
// one line at 320px, and call and message are the two anyone presses.
// Email and share are in the sheet, one tap away.
chk("email is not on the row", out.includes('href="mailto:anil@example.com"'), false);
chk("nor share", /<button class="iact alt"/.test(out), false);
chk("just call and WhatsApp", (out.match(/class="iact /g) || []).length, 2);
// The card itself opens the sheet; the chevron is what says so.
chk("a chevron says it opens", /class="cgo"/.test(out), true);
chk("and it is announced to a screen reader", /aria-label="Details: Anil Kulkarni"/.test(out), true);
chk("reachable by keyboard", /tabindex="0"/.test(out), true);
// The whole point: the optional fields are NOT on the card.
chk("vehicle is not on the card", out.includes("MH-09-AB-1234"), false);
chk("profession is not on the card", out.includes("Paediatrician"), false);
chk("emergency contact is not on the card", out.includes("Sunil Kulkarni"), false);
chk("no detail lines at all", /class="cdet"/.test(out), false);

console.log("\nthe detail sheet");
const sheetBox = { hidden: true, textContent: "", children: [],
  appendChild(c) { this.children.push(c); return c; },
  get outer() { return this.children.map(c => c.outer || "").join(""); } };
globalThis.document.getElementById = () => sheetBox;
globalThis.document.documentElement = { classList: { add(){}, remove(){} } };
api.openSheet(row, map, null, "Anil Kulkarni");
const sh = sheetBox.outer;
chk("it opened", sheetBox.hidden, false);
chk("names the person", sh.includes("Anil Kulkarni"), true);
chk("every optional field is here", sh.includes("MH-09-AB-1234") &&
  sh.includes("Paediatrician") && sh.includes("Sunil Kulkarni"), true);
chk("fields are labelled", /<b[^>]*>Vehicle No: <\/b>/.test(sh), true);
chk("the number is spelled out and tappable", sh.includes('href="tel:+919833040011"'), true);
chk("blood badge repeated here too", /class="blood">O\+</.test(sh), true);
chk("it can be closed", /class="sheet-x"/.test(sh), true);
chk("and the actions come along", /class="go sheet-go"/.test(sh), true);
chk("including the email the row leaves out",
  sh.includes('href="mailto:anil@example.com"'), true);

/* Owner details belong in the sheet now. They are the reason a tenant's card
   exists at all for many societies, so losing them silently would be bad. */
const withOwner = { Name:"Vikram Rathore", Block:"B", Flat:"B-403",
  Phone:"+91 98330 40017", Email:"", Type:"Tenant", "Blood Group":"A+",
  Profession:"Teacher", "Owner Name":"Rajesh Menon",
  "Owner Phone":"+91 98200 44002", "Owner Address":"B-201, Green Valley" };
const om = classify(Object.keys(withOwner));

console.log("\nowner details, in the sheet");
chk("owner columns grouped, not detail lines", om.owner.name, "Owner Name");
chk("owner phone is not the tenant call button", om.phone.join(","), "Phone");
const oCard = contact(withOwner, om, false, "").outer;
chk("not on the compact card", oCard.includes("Rajesh Menon"), false);
chk("tenant's own number still is", oCard.includes('href="tel:+919833040017"'), true);

sheetBox.children = []; sheetBox.hidden = true;
api.openSheet(withOwner, om, null, "Vikram Rathore");
const oSheet = sheetBox.outer;
chk("owner block in the sheet", /class="sowner"/.test(oSheet), true);
chk("owner name inside it", oSheet.includes("Rajesh Menon"), true);
chk("owner number is tappable", oSheet.includes('href="tel:+919820044002"'), true);
chk("owner address too", oSheet.includes("B-201, Green Valley"), true);

const noOwner = Object.assign({}, withOwner,
  { "Owner Name":"", "Owner Phone":"", "Owner Address":"" });
sheetBox.children = [];
api.openSheet(noOwner, om, null, "X");
chk("no owner block when those columns are empty",
  /class="sowner"/.test(sheetBox.outer), false);

console.log("\nflat and row house sharing an address");
const flatB11 = { Name:"Narendra Heda", Block:"B", Flat:"11", "Unit Type":"Flat",
  Phone:"+91 87931 09590", Email:"", Type:"Owner" };
const rowB11 = Object.assign({}, flatB11,
  { Name:"Someone Else", "Unit Type":"Row House", Phone:"+91 87931 09591" });
const um = classify(Object.keys(flatB11));

chk("unit type is its own role", um.unit, "Unit Type");
chk("it is not mistaken for the address", um.place.includes("Unit Type"), false);
chk("nor for the owner/tenant role", um.role, "Type");
chk("and it is not repeated as a detail line", um.rest.includes("Unit Type"), false);

const cFlat = contact(flatB11, um, false, "").outer;
const cRow = contact(rowB11, um, false, "").outer;
chk("flat card carries its chip", /class="utype">Flat</.test(cFlat), true);
chk("row house card carries its chip", /class="utype">Row House</.test(cRow), true);
chk("the address itself is unchanged", cFlat.includes("B") && cFlat.includes("11"), true);
chk("the two cards are distinguishable", cFlat === cRow, false);

// A sheet with no such column must look exactly as it did before.
const plain = { Name:"Anil", Block:"A", Flat:"A-101", Phone:"+91 98330 40011" };
const pm = classify(Object.keys(plain));
chk("no column, no chip", /class="utype"/.test(contact(plain, pm, false, "").outer), false);
chk("no column, no phantom role", pm.unit, "null");
// An empty cell is the same as no column.
chk("blank value renders no chip", /class="utype"/.test(
  contact(Object.assign({}, flatB11, { "Unit Type":"" }), um, false, "").outer), false);


console.log("\nWhatsApp numbers");
for (const [num, want] of [
  ["+91 98330 40011", "919833040011"],
  ["9833040011",      "919833040011"],   // bare 10-digit gets the country code
  ["09833040011",     "919833040011"],
  ["+1 415 555 0123", "14155550123"],    // already has one, left alone
  ["100",             ""],               // a helpline has no WhatsApp account
  // A landline offering a WhatsApp button opens a chat with nobody. An Indian
  // mobile is ten digits beginning 6-9; an STD code begins 0 and fails that.
  ["0230 2431234",    ""],               // Ichalkaranji landline
  ["022-27654321",    ""],               // Mumbai landline
  ["1800-233-3435",   ""],               // toll-free
  ["5673020210",      ""],               // ten digits, but not a mobile prefix
  ["00919673020210",  "919673020210"],   // written with a 00 prefix
  ["1912",            ""],
  ["",                ""]
]) chk(`waNum ${JSON.stringify(num)}`, waNum(num), want);

api.setMeta({ country: "44" });
chk("country code comes from About", waNum("7911123456"), "447911123456");
api.setMeta({ name: "Laxmi Venkatesh Nagar" });

const svc = { title:"Services & Help", sos:false,
  map: classify(["Name","Role","Charges","Timings","Phone","Notes"]) };
const svcRow = { Name:"Rahul Shelar", Role:"Plumber", Charges:"₹100 / visit",
  Timings:"9 AM – 7 PM", Phone:"9673020210", Notes:"Plumbing solutions" };
const svcCard = contact(svcRow, svc.map, false, "", svc).outer;

console.log("\nWhatsApp button");
chk("rendered for a mobile", svcCard.includes('href="https://wa.me/919673020210"'), true);
chk("opens in a new tab", /class="iact wa"[^>]*target="_blank"/.test(svcCard), true);
chk("and is labelled", svcCard.includes('aria-label="WhatsApp Rahul Shelar"'), true);
chk("call button still there", svcCard.includes('href="tel:9673020210"'), true);

const helpline = { Service:"Police", Phone:"100" };
const hm = classify(Object.keys(helpline));
const hCard = contact(helpline, hm, true, "", { title:"Emergency", sos:true, map:hm }).outer;
chk("no WhatsApp on a 3-digit helpline", hCard.includes("wa.me"), false);
chk("but it is still callable", hCard.includes('href="tel:100"'), true);


/* Sharing a tradesperson's number is normal neighbourly behaviour. Sharing a
   resident's is the thing the page's own notice asks members not to do. */
console.log("\nwho gets a Share button");
const residents = { title:"Residents", sos:false, map };
chk("services, yes", shareable(svc), true);
chk("emergency, yes", shareable({ title:"Emergency", sos:true, map:hm }), true);
chk("residents, no", shareable(residents), false);
chk("committee, no", shareable({ title:"Committee", sos:false, map:classify(["Name","Role","Phone"]) }), false);

api.setMeta({ name:"LVN", sharing:"all" });
chk('Sharing=all opens it up', shareable(residents), true);
api.setMeta({ name:"LVN", sharing:"off" });
chk('Sharing=off closes it everywhere', shareable(svc), false);
api.setMeta({ name:"Laxmi Venkatesh Nagar" });

chk("no share button on the row either", /<button class="iact alt"/.test(svcCard), false);
chk("none on a resident card", /<button class="iact alt"/.test(contact(row, map, false, "", residents).outer), false);

console.log("\nthe shared message");
api.setNotes({ serviceshelp: "Contact at your own risk — numbers are sourced from residents." });
const msg = shareText(svcRow, svc.map, svc, "Rahul Shelar");
chk("names the person", msg.includes("Rahul Shelar"), true);
chk("carries the trade", msg.includes("Plumber"), true);
chk("carries the number", msg.includes("9673020210"), true);
chk("carries the charge", msg.includes("₹100 / visit"), true);
chk("carries the timings", msg.includes("9 AM – 7 PM"), true);
// The caveat must travel with the number, not stay behind on the page.
chk("carries the section's caution", msg.includes("at your own risk"), true);
chk("credits the directory", msg.includes("Laxmi Venkatesh Nagar"), true);
chk("links back to the site", msg.includes("https://society.example/"), true);
api.setNotes({});
chk("no note, no warning line", shareText(svcRow, svc.map, svc, "R").includes("⚠️"), false);

console.log("\nlist or grid");
chk("a switch beside the search box", /<div class="vswitch" id="vswitch"/.test(html), true);
chk("it sits in a row with the field", /class="sfield-row"/.test(html), true);
chk("both shapes are offered",
  /data-cards="list"/.test(html) && /data-cards="grid"/.test(html), true);
// A phone gets one line each; a wide screen has the room for cards.
chk("the default follows the screen width",
  /matchMedia\("\(min-width:700px\)"\)/.test(html), true);
chk("the choice is remembered", /localStorage[\s\S]{0,60}"dir-cards"/.test(html), true);
chk("the mode is set on the root, where the CSS reads it",
  /setAttribute\("data-cards"/.test(html), true);
chk("list collapses the grid to one column",
  /html\[data-cards="list"\] \.cgrid\{grid-template-columns:1fr/.test(html), true);
chk("and puts the name and the buttons on one row",
  /html\[data-cards="list"\] \.ccard\{flex-direction:row/.test(html), true);
// 54px, so a one-line row is still a comfortable tap target.
chk("the row is still big enough to tap",
  /html\[data-cards="list"\] \.ccard\{[\s\S]{0,140}min-height:54px/.test(html), true);
chk("the avatar makes way for the name",
  /html\[data-cards="list"\] \.av\{display:none\}/.test(html), true);

console.log(fails ? `\n  ${fails} FAILED` : "\n  all checks passed");
process.exit(fails ? 1 : 0);
