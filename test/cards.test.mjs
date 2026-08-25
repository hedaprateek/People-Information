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
  grab(/function contact\(row, map, sos, term, s\)[\s\S]*?\n    return c;\n  \}/),
  'function t(k){ return {ownerDetails:"Owner details",moreDetails:"More details",' +
    'call:"Call",email:"Email",whatsapp:"WhatsApp",share:"Share"}[k] || k; }',
  'function key(s){ return String(s).toLowerCase().replace(/[^a-z0-9]+/g,""); }',
  "function sectionTitle(s){ return s.title; }",
  "var lang = 'en';",
  "return { contact, classify, waNum, shareable, shareText,",
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

const out = contact(row, map, false, "").outer;
const visible = out.split('class="mbody"')[0];
const folded = out.split('class="mbody"')[1] || "";

console.log("\ncard shape, no search");
chk("blood badge rendered", /class="blood">O\+</.test(out), true);
chk("visible lines = 1 location + 2 details", (visible.match(/class="cdet"/g)||[]).length, 3);
chk("the rest are folded away", (folded.match(/class="cdet"/g)||[]).length >= 4, true);
chk("a More disclosure exists", /<details class="more"/.test(out), true);
chk("it is closed by default", /<details class="more" open/.test(out), false);
chk("the count is in the summary", /More details \(\d+\)/.test(out), true);
chk("folded values are still in the page", out.includes("MH-09-AB-1234"), true);

console.log("\nwhen a search matches a folded field");
chk("More opens automatically", /<details class="more" open/.test(
  contact(row, map, false, "paediatrician").outer), true);
chk("and stays closed otherwise", /<details class="more" open/.test(
  contact(row, map, false, "anil").outer), false);

const sparse = { Name:"Ayesha Khan", Block:"C", Flat:"C-304", Phone:"+91 98330 40020",
  Email:"", Type:"Tenant", "Blood Group":"B-", "Emergency Contact":"",
  "Vehicle No":"", "Parking Slot":"", "Vehicle Type":"", Profession:"Architect",
  Language:"", Occupants:"", Pets:"" };
const thin = contact(sparse, map, false, "").outer;

console.log("\nsomeone who answered almost nothing");
chk("blood badge still shown", /class="blood">B-</.test(thin), true);
chk("no empty detail lines", /: <\/b><\/div>/.test(thin), false);
chk("no More button with nothing to fold", /<details class="more"/.test(thin), false);


/* The owner block sits after the action row, so any change to how details
   are rendered can quietly drop it. */
const withOwner = { Name:"Vikram Rathore", Block:"B", Flat:"B-403",
  Phone:"+91 98330 40017", Email:"", Type:"Tenant", "Blood Group":"A+",
  Profession:"Teacher", "Owner Name":"Rajesh Menon",
  "Owner Phone":"+91 98200 44002", "Owner Address":"B-201, Green Valley" };
const om = classify(Object.keys(withOwner));
const oc = contact(withOwner, om, false, "").outer;

console.log("\nowner block on a tenanted flat");
chk("owner columns grouped, not detail lines", om.owner.name, "Owner Name");
chk("owner phone is not the tenant call button", om.phone.join(","), "Phone");
chk("owner disclosure rendered", /<details class="owner"/.test(oc), true);
chk("owner name inside it", oc.includes("Rajesh Menon"), true);
chk("owner number is tappable", oc.includes('href="tel:+919820044002"'), true);
chk("tenant own number still primary", oc.includes('href="tel:+919833040017"'), true);

const noOwner = Object.assign({}, withOwner,
  { "Owner Name":"", "Owner Phone":"", "Owner Address":"" });
chk("no owner block when those columns are empty",
  /<details class="owner"/.test(contact(noOwner, om, false, "").outer), false);


/* A wing and number repeat between a flat and a row house. Without the unit
   type on the card the two are the same address and nobody can tell which
   B-11 they are looking at. */
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

chk("share button on a service card", /<button class="iact alt"/.test(svcCard), true);
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

console.log(fails ? `\n  ${fails} FAILED` : "\n  all checks passed");
process.exit(fails ? 1 : 0);
