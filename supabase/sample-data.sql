-- ============================================================================
--  SAMPLE DATA — so you can see the directory fully populated.
--  Run in Supabase SQL Editor AFTER migration.sql.
--
--  Rows are tagged with a hidden `is_sample` column that the public page never
--  reads, so nothing shows "[sample]" on screen. Remove it all later with the
--  two lines at the bottom of this file; your own data is untouched.
-- ============================================================================

alter table public.members            add column if not exists is_sample boolean not null default false;
alter table public.important_contacts add column if not exists is_sample boolean not null default false;

do $$
declare v_id bigint;
begin
  select id into v_id from public.societies order by id limit 1;

  -- Give the society a real identity (only while still on the default name)
  update public.societies
     set name            = 'Green Valley Residency',
         tagline         = 'A Co-operative Housing Society',
         address         = 'Plot 14, Sector 22, Kharghar',
         city            = 'Navi Mumbai',
         pincode         = '410210',
         registration_no = 'NBOM/HSG/1284/2009'
   where id = v_id and name = 'My Society';

  -- ---------------------------------------------------------------- committee
  insert into public.members
    (society_id, name, block, flat_no, phone, email, role, is_committee, committee_rank, is_sample)
  values
    (v_id,'Ramesh Iyer',    'A','A-402','+91 98200 11223','ramesh.iyer@example.com','Chairman',        true,1,true),
    (v_id,'Sunita Deshmukh','B','B-105','+91 98200 11224','sunita.d@example.com',   'Hon. Secretary',  true,2,true),
    (v_id,'Farhan Qureshi', 'A','A-701','+91 98200 11225','farhan.q@example.com',   'Treasurer',       true,3,true),
    (v_id,'Meera Nair',     'C','C-203','+91 98200 11226','meera.nair@example.com', 'Committee Member',true,4,true),
    (v_id,'Harpreet Singh', 'B','B-604','+91 98200 11227',null,                     'Committee Member',true,5,true);

  -- ---------------------------------------------------------------- residents
  insert into public.members
    (society_id, name, block, flat_no, phone, email, role, is_sample)
  values
    (v_id,'Anil Kulkarni',     'A','A-101','+91 98330 40011','anil.k@example.com',   'Owner', true),
    (v_id,'Priya Raghavan',    'A','A-202','+91 98330 40012','priya.r@example.com',  'Owner', true),
    (v_id,'Imran Shaikh',      'A','A-305','+91 98330 40013',null,                   'Tenant',true),
    (v_id,'Kavita Joshi',      'A','A-506','+91 98330 40014','kavita.j@example.com', 'Owner', true),
    (v_id,'Rajesh Menon',      'B','B-201','+91 98330 40015',null,                   'Owner', true),
    (v_id,'Deepa Chatterjee',  'B','B-302','+91 98330 40016','deepa.c@example.com',  'Owner', true),
    (v_id,'Vikram Rathore',    'B','B-403','+91 98330 40017',null,                   'Tenant',true),
    (v_id,'Nisha Patel',       'B','B-505','+91 98330 40018','nisha.p@example.com',  'Owner', true),
    (v_id,'Suresh Pillai',     'C','C-102','+91 98330 40019',null,                   'Owner', true),
    (v_id,'Ayesha Khan',       'C','C-304','+91 98330 40020','ayesha.k@example.com', 'Tenant',true),
    (v_id,'Gopal Verma',       'C','C-405','+91 98330 40021',null,                   'Owner', true),
    (v_id,'Lakshmi Subramanian','C','C-506','+91 98330 40022','lakshmi.s@example.com','Owner',true);

  -- ---------------------------------------------------- emergency + services
  insert into public.important_contacts
    (society_id, category, label, name, phone, alt_phone, notes, is_emergency, display_order, is_sample)
  values
    (v_id,'Emergency','Ambulance',     null,            '102',             '108', 'Toll free, 24x7',      true, 1,true),
    (v_id,'Emergency','Police',        null,            '100',             null,  'Kharghar station',     true, 2,true),
    (v_id,'Emergency','Fire Brigade',  null,            '101',             null,  'Toll free, 24x7',      true, 3,true),
    (v_id,'Emergency','Security Gate', 'Ravi Yadav',    '+91 90040 55501', null,  'Main gate, 24x7',      true, 4,true),

    (v_id,'Maintenance','Plumber',        'Santosh Gupta','+91 90040 55511',null,'9 AM – 7 PM',           false,10,true),
    (v_id,'Maintenance','Electrician',    'Naresh Bhoir', '+91 90040 55512',null,'9 AM – 8 PM',           false,11,true),
    (v_id,'Maintenance','Lift Technician','Otis Service', '+91 90040 55513',null,'AMC — 4 hr response',   false,12,true),
    (v_id,'Maintenance','Pest Control',   'HiCare',       '+91 90040 55514',null,'Quarterly, by booking', false,13,true),
    (v_id,'Maintenance','Housekeeping',   'Shanti Devi',  '+91 90040 55515',null,'6 AM – 2 PM',           false,14,true),

    (v_id,'Utilities','Water Tanker',        'Jai Bhavani',  '+91 90040 55521',null,'Same-day delivery', false,20,true),
    (v_id,'Utilities','Electricity (MSEDCL)',null,           '1912',           null,'Outage helpline',   false,21,true),
    (v_id,'Utilities','Gas Agency',          'Mahanagar Gas','+91 90040 55522',null,'Leak: 1800 22 9944',false,22,true),

    (v_id,'Society Office','Manager',    'D. Kamble','+91 90040 55531',null,'Mon–Sat, 10 AM – 6 PM',      false,30,true),
    (v_id,'Society Office','Accountant', 'S. Rane',  '+91 90040 55532',null,'Tue & Thu, 4 PM – 7 PM',     false,31,true);
end $$;

select 'Sample data loaded — reload the viewer.' as status;

-- ============================================================================
--  TO REMOVE ALL SAMPLE DATA LATER, run these two lines:
--
--    delete from public.members            where is_sample;
--    delete from public.important_contacts where is_sample;
-- ============================================================================
