/**
 * Builds the resident data-collection form, and a helper that turns the
 * responses into sheets this directory can import.
 *
 * HOW TO RUN
 *   1. https://script.google.com  →  New project
 *   2. Delete the sample code, paste this whole file, Save
 *   3. Choose `createResidentForm` in the function dropdown → Run
 *   4. Approve the permissions prompt (it is your own account)
 *   5. The form and spreadsheet URLs are printed in the Execution log
 *
 * LATER, once responses are in:
 *   Run `buildDirectorySheets` to generate a Residents sheet (public) and a
 *   _Private sheet (never published) from the raw responses.
 */

var SOCIETY = 'Green Valley Residency';   // ← change to your society's name
var BLOCKS  = ['A', 'B', 'C'];            // ← change to your blocks/wings
var FAMILY_SLOTS = 5;                     // family member rows on the form

/* ────────────────────────────────────────────────────────────── */

function createResidentForm() {
  var form = FormApp.create(SOCIETY + ' — Resident Information');

  form.setDescription(
    'Please fill this in once per flat. It takes about three minutes.\n\n' +
    'We use it to keep the society directory and emergency records up to date.\n\n' +
    'Published in the members-only directory: your name, flat number and contact ' +
    'number, and — for a tenanted flat — the owner\'s name, contact and address, ' +
    'so residents and the committee can reach them.\n\n' +
    'Kept private with the committee: dates of birth, and the details of other ' +
    'family members.');

  form.setCollectEmail(false);          // we ask for email explicitly instead
  form.setProgressBar(true);
  form.setAllowResponseEdits(true);     // let people correct a mistake later
  form.setLimitOneResponsePerUser(false);

  var phoneCheck = FormApp.createTextValidation()
    .setHelpText('Enter a 10-digit Indian mobile number, e.g. 9820011223 or +91 98200 11223')
    .requireTextMatchesPattern('^(\\+?91[\\s-]?)?[6-9]\\d{4}[\\s-]?\\d{5}$')
    .build();

  /* ── Page 1 — the flat ───────────────────────────────────── */
  var block = form.addMultipleChoiceItem()
    .setTitle('Block / Wing')
    .setChoiceValues(BLOCKS)
    .showOtherOption(true)
    .setRequired(true);

  form.addTextItem()
    .setTitle('Flat number')
    .setHelpText('For example 402, or A-402')
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle('Full postal address of this flat')
    .setHelpText('Including society name, road and pincode')
    .setRequired(true);

  /* ── Page 2 — primary contact ────────────────────────────── */
  var pContact = form.addPageBreakItem()
    .setTitle('Primary contact')
    .setHelpText('The person we should reach first about this flat.');

  form.addTextItem().setTitle('Full name').setRequired(true);

  form.addTextItem()
    .setTitle('Mobile number')
    .setValidation(phoneCheck)
    .setRequired(true);

  form.addTextItem()
    .setTitle('Alternate number')
    .setHelpText('Optional');

  form.addTextItem()
    .setTitle('Email address')
    .setHelpText('Optional — used for society circulars')
    .setValidation(FormApp.createTextValidation()
      .setHelpText('Enter a valid email address')
      .requireTextIsEmail()
      .build());

  form.addDateItem()
    .setTitle('Date of birth')
    .setHelpText('Kept private with the committee — never published')
    .setIncludesYear(true);

  /* ── Page 3 — family ─────────────────────────────────────── */
  var pFamily = form.addPageBreakItem()
    .setTitle('Family members')
    .setHelpText('Everyone else living in this flat. Leave unused rows blank. ' +
                 'Dates of birth stay private with the committee.');

  for (var i = 1; i <= FAMILY_SLOTS; i++) {
    form.addTextItem().setTitle('Member ' + i + ' — full name');
    form.addMultipleChoiceItem()
      .setTitle('Member ' + i + ' — relation')
      .setChoiceValues(['Spouse', 'Son', 'Daughter', 'Father', 'Mother',
                        'Brother', 'Sister', 'Other'])
      .showOtherOption(true);
    form.addDateItem()
      .setTitle('Member ' + i + ' — date of birth')
      .setIncludesYear(true);
  }

  /* ── Page 4 — occupancy, the branch point ────────────────── */
  var pType = form.addPageBreakItem().setTitle('Occupancy');
  var occupancy = form.addMultipleChoiceItem()
    .setTitle('Is this flat occupied by the owner or a tenant?')
    .setRequired(true);

  /* ── Page 5 — landlord, tenants only ─────────────────────── */
  var pOwner = form.addPageBreakItem()
    .setTitle('Owner details')
    .setHelpText('Because this flat is tenanted, the society needs the owner on record. ' +
                 'The owner\'s name, contact and address are shown against this flat in ' +
                 'the members-only directory, so residents and the committee can reach ' +
                 'them directly. Please make sure the owner is aware.');

  form.addTextItem().setTitle("Owner's full name").setRequired(true);
  form.addTextItem().setTitle("Owner's mobile number")
    .setValidation(phoneCheck).setRequired(true);
  form.addParagraphTextItem().setTitle("Owner's current address").setRequired(true);
  form.addTextItem().setTitle("Owner's email address").setHelpText('Optional');

  /* ── Page 6 — consent ────────────────────────────────────── */
  var pConsent = form.addPageBreakItem().setTitle('Consent and submit');

  form.addCheckboxItem()
    .setTitle('Publishing consent')
    .setHelpText('The directory is a web page reachable only with an access code issued ' +
                 'to each flat. It is not public, but it is visible to every resident.')
    .setChoiceValues([
      'I agree that my name, flat number and contact number may appear in the ' +
      'members-only residents directory',
      'If this flat is tenanted, I confirm the owner is aware their name, contact ' +
      'and address will appear against it'
    ])
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle('Anything else the committee should know?')
    .setHelpText('Optional — medical needs, vehicle numbers, an alternate emergency contact');

  /* ── Wire the branch, now that every page exists ─────────── */
  occupancy.setChoices([
    occupancy.createChoice('Owner',  pConsent),   // skip the landlord page
    occupancy.createChoice('Tenant', pOwner)
  ]);
  pOwner.setGoToPage(pConsent);
  // Unused variables kept for clarity of page order:
  if (!block || !pContact || !pFamily || !pType) { /* no-op */ }

  /* ── Responses land in a spreadsheet ─────────────────────── */
  var ss = SpreadsheetApp.create(SOCIETY + ' — Resident Responses');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());

  Logger.log('FORM (share this):  %s', form.getPublishedUrl());
  Logger.log('FORM (edit):        %s', form.getEditUrl());
  Logger.log('RESPONSES SHEET:    %s', ss.getUrl());
  return { form: form.getPublishedUrl(), sheet: ss.getUrl() };
}

/* ══════════════════════════════════════════════════════════════
   Turn raw responses into directory-shaped sheets.
   Run this from the RESPONSES SPREADSHEET (Extensions → Apps Script),
   or paste this file there too.
   ══════════════════════════════════════════════════════════════ */

function buildDirectorySheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Open the responses spreadsheet and run this from there.');

  var src = ss.getSheets()[0];
  var data = src.getDataRange().getValues();
  if (data.length < 2) throw new Error('No responses yet.');

  var head = data[0].map(String);
  var idx = {};
  head.forEach(function (h, i) { idx[h.trim().toLowerCase()] = i; });
  function col(rx) {
    for (var k in idx) if (rx.test(k)) return idx[k];
    return -1;
  }
  function val(row, i) { return i < 0 ? '' : String(row[i] == null ? '' : row[i]).trim(); }
  function ymd(v) {
    if (!v) return '';
    var d = new Date(v);
    return isNaN(d) ? String(v) : Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  var cBlock = col(/^block/), cFlat = col(/flat number/), cAddr = col(/postal address/),
      cName  = col(/^full name/), cMob = col(/^mobile number/), cAlt = col(/alternate number/),
      cMail  = col(/^email address/), cDob = col(/^date of birth/),
      cType  = col(/owner or a tenant/),
      cONm   = col(/owner's full name/), cOMob = col(/owner's mobile/),
      cOAddr = col(/owner's current address/), cNote = col(/anything else/);

  var pub  = [['Name', 'Block', 'Flat', 'Phone', 'Email', 'Type',
               'Owner Name', 'Owner Phone', 'Owner Address']];
  var priv = [['Flat', 'Person', 'Relation', 'DOB', 'Type',
               'Owner Name', 'Owner Phone', 'Owner Address', 'Notes']];

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var blk = val(row, cBlock), flat = val(row, cFlat);
    if (!flat) continue;
    var type = /tenant/i.test(val(row, cType)) ? 'Tenant' : 'Owner';
    var who  = val(row, cName);

    // Owner details are published for tenanted flats so residents can reach
    // the landlord; dates of birth stay in _Private.
    var isTenant = type === 'Tenant';
    pub.push([who, blk, flat, val(row, cMob), val(row, cMail), type,
              isTenant ? val(row, cONm) : '',
              isTenant ? val(row, cOMob) : '',
              isTenant ? val(row, cOAddr) : '']);

    priv.push([flat, who, 'Primary', ymd(val(row, cDob)), type,
               val(row, cONm), val(row, cOMob), val(row, cOAddr), val(row, cNote)]);

    for (var m = 1; m <= FAMILY_SLOTS; m++) {
      var nmI = col(new RegExp('member ' + m + ' — full name')),
          reI = col(new RegExp('member ' + m + ' — relation')),
          dbI = col(new RegExp('member ' + m + ' — date of birth'));
      var nm = val(row, nmI);
      if (!nm) continue;
      priv.push([flat, nm, val(row, reI) || 'Family', ymd(val(row, dbI)), type, '', '', '', '']);
    }
    if (cAddr < 0) { /* address column absent — nothing to carry */ }
  }

  write(ss, 'Residents', pub);
  write(ss, '_Private', priv);

  Logger.log('Residents: %s rows.  _Private: %s rows.', pub.length - 1, priv.length - 1);
  Logger.log('Now: File → Download → Microsoft Excel (.xlsx), then import in the admin panel.');
}

function write(ss, name, rows) {
  var sh = ss.getSheetByName(name);
  if (sh) sh.clear(); else sh = ss.insertSheet(name);
  sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  sh.getRange(1, 1, 1, rows[0].length).setFontWeight('bold');
  sh.setFrozenRows(1);
  // Phone numbers and dates must stay text or Excel mangles them on export.
  sh.getRange(1, 1, rows.length, rows[0].length).setNumberFormat('@');
  sh.autoResizeColumns(1, rows[0].length);
}
