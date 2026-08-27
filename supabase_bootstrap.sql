-- =============================================================================
-- IIT Mandi Finance Portal -- Supabase bootstrap (public schema only)
--
-- Extracted from data_base.sql, which is a FULL pg_dump and CANNOT be run
-- against a Supabase project (it collides with the managed auth/storage/
-- realtime/vault schemas). This file contains only what the app needs.
--
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
-- =============================================================================

-- ---------- department enum ----------
CREATE TYPE public.department AS ENUM (
    'Staff Recruitment Section',
    'Dean Infrastructure (I&S)/Land Acquisition',
    'Dean Resource Generation & Alumni Relations',
    'Central Dak Section',
    'Health Center',
    'School of Computing & Electrical Engineering',
    'School of Chemical Sciences',
    'School of Physical Sciences',
    'School of Mathematical & Statistical Sciences',
    'School of Biosciences & Bio Engineering',
    'School of Mechanical & Materials Engineering',
    'School of Civil & Environmental Engineering',
    'School of Humanities & Social Sciences',
    'School of Management',
    'Advanced Materials Research Center (AMRC)',
    'Centre of Artificial Intelligence and Robotics (CAIR)',
    'Center for Quantum Science and Technologies (CQST)',
    'Centre for Design & Fabrication of Electronic Devices (C4DFED)',
    'Center for Human-Computer Interaction (CHCI)',
    'Center for Climate Change and Disaster Management (C3DAR)',
    'IIT Mandi i-Hub & HCI',
    'IKSMHA Center',
    'Centre for Continuing Education (CCE)',
    'JEE CELL',
    'JAM',
    'GATE',
    'Office of Chief Warden',
    'Parashar Hostel',
    'Chandertaal Hostel',
    'Suvalsar Hostel',
    'Nako Hostel',
    'Dashir Hostel',
    'Beas Kund Hostel',
    'Manimahesh Hostel',
    'Suraj Taal Hostel',
    'Gauri Kund Hostel',
    'Central Mess',
    'Sports',
    'NSS',
    'Guidance & Counselling Cell',
    'Construction & Maintainance Cell',
    'Transportation',
    'Guest House',
    'Housekeeping Services & Waste Management',
    'Creche',
    'Security Unit',
    'Common Rooms',
    'Career & Placement Cell',
    'IIT Mandi Catalyst',
    'Recreation Center',
    'CPWD',
    'Banks',
    'IPDC',
    'IR',
    'Mind Tree School',
    'Renuka Hostel',
    'Rewalsar',
    'Director Office',
    'Deans',
    'Associate Deans',
    'Registrar Office',
    'Administration and Establishment Section',
    'Faculty Establishment and Recruitment',
    'Finance and Accounts',
    'Store and Purchase Section',
    'Rajbhasa Section',
    'Ranking Cell (RC)',
    'Media Cell',
    'Academics Section',
    'Academic Affairs',
    'Research Affairs',
    'Legal Section',
    'Internal Audit',
    'Central Library',
    'DIGITAL AND COMPUTING SERVICES',
    'Dean (SRIC & IR ) Office',
    'Dean (Students) Office'
);

-- ---------- table: bills ----------
CREATE TABLE public.bills (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id text NOT NULL,
    po_details text,
    po_value numeric(12,2),
    supplier_name text,
    supplier_address text,
    item_category text,
    item_description text,
    qty integer,
    bill_details text,
    indenter_name text,
    qty_issued integer,
    source_of_fund text,
    stock_entry text,
    location text,
    remarks text,
    remarks1 text,
    remarks2 text,
    remarks3 text,
    remarks4 text,
    created_at timestamp without time zone DEFAULT now(),
    status text DEFAULT 'User'::text,
    snp text DEFAULT 'NULL'::text,
    audit text DEFAULT 'NULL'::text,
    finance_admin text,
    employee_name text,
    employee_department public.department,
    noted boolean DEFAULT false,
    has_bank_guarantee boolean,
    bank_guarantee_details text,
    bank_guarantee_amount numeric(12,2),
    date_of_installation timestamp without time zone,
    date_of_delivery timestamp without time zone,
    CONSTRAINT bills_audit_check CHECK ((audit = ANY (ARRAY['Pending'::text, 'Reject'::text, 'Hold'::text, 'Approved'::text]))),
    CONSTRAINT bills_finance_admin_check CHECK (((finance_admin IS NULL) OR (finance_admin = ANY (ARRAY['Pending'::text, 'Reject'::text, 'Hold'::text, 'Approved'::text])))),
    CONSTRAINT bills_snp_check CHECK ((snp = ANY (ARRAY['Pending'::text, 'Reject'::text, 'Hold'::text, 'Approved'::text]))),
    CONSTRAINT bills_status_check CHECK ((status = ANY (ARRAY['User'::text, 'Student Purchase'::text, 'Audit'::text, 'Finance Admin'::text, 'Accepted'::text])))
);

-- ---------- table: employees ----------
CREATE TABLE public.employees (
    id text DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    employee_type text,
    created_at timestamp without time zone DEFAULT now(),
    employee_code text,
    employee_name text,
    department public.department NOT NULL,
    CONSTRAINT employees_employee_type_check CHECK ((employee_type = ANY (ARRAY['Finance Admin'::text, 'Finance Employee'::text, 'Audit'::text, 'Bill Employee'::text, 'Student Purchase'::text, 'bill_employee_edit'::text, 'bill_employee_fill'::text, 'pda-manager'::text])))
);

-- ---------- table: pda_balances ----------
CREATE TABLE public.pda_balances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id text,
    balance numeric(12,2) DEFAULT 0,
    updated_at timestamp without time zone DEFAULT now(),
    department public.department,
    email text NOT NULL
);

-- ---------- constraints ----------
ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_email_key UNIQUE (email);

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_employee_code_key UNIQUE (employee_code);

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.pda_balances
    ADD CONSTRAINT pda_balances_pkey PRIMARY KEY (id);

-- ---------- seed data ----------
-- COPY ... FROM stdin works in the Supabase SQL editor.
COPY public.bills (id, employee_id, po_details, po_value, supplier_name, supplier_address, item_category, item_description, qty, bill_details, indenter_name, qty_issued, source_of_fund, stock_entry, location, remarks, remarks1, remarks2, remarks3, remarks4, created_at, status, snp, audit, finance_admin, employee_name, employee_department, noted, has_bank_guarantee, bank_guarantee_details, bank_guarantee_amount, date_of_installation, date_of_delivery) FROM stdin;
36ab4d7b-cec6-4243-b954-14fb171ec782	B24119	\N	69999.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	ss (By: B24119 at 10/2/2025, 6:38:48 PM)	jj (By: B24119 at 10/2/2025, 6:37:50 PM)	zczs (By: B24119 at 10/2/2025, 6:38:13 PM)	\N	\N	2025-10-02 13:06:47.981041	Accepted	Approved	Approved	Approved	f	\N	f	\N	\N	\N	\N	\N
b6592b99-a32e-4c96-9c8c-0eca2255d6d9	USER	hhkhnm	55000.00	kaka	kaka	Consumables	djojndo;b	88	dvojn	pdnv"	99	dvn	dn	99nk	\N	\N	\N	\N	\N	2025-10-14 14:07:25.838874	Finance Admin	\N	Approved	Pending	harmanprit	\N	f	\N	\N	\N	\N	\N
d3ca6ee6-fb7a-4879-a1f6-4cf628b206a6	User	A1 quality	52000.00	Aryan	nashik	Consumables	Keyboard and Mouse	30	pata nahi	Arjun	30	periminder Sir	30	pune	\N	okay but we need only 25	\N	\N	\N	2025-09-13 12:42:02.68316	Accepted	Approved	Approved	Approved	kartavya	\N	f	\N	\N	\N	\N	\N
78a68695-725b-4833-810b-33eac7326d22	User	SCEE labs instrument	4000.00	Karan	Pune	Minor	Electro spectrometer 	4	Purchase for A18 2 lab of vlsi	Hardik	3	Aditya nigam sir	3	Pune	\N	\N	\N	\N	\N	2025-09-13 13:46:20.766195	User	\N	Pending	\N	Hardik	\N	f	\N	\N	\N	\N	\N
d2a1feae-9b8c-48bb-8f04-a1aeda7a57e6	b24199	45i4	8000.00	fsbknlkn	sdkndn	Consumable	mac book	1	4545	353	1	dogfns	3t53	pratappur	\N	\N	\N	\N	\N	2025-09-06 10:11:16.747438	Accepted	\N	Pending	Approved	\N	\N	f	\N	\N	\N	\N	\N
5a21514d-5f15-4eb7-8620-879b3d1b89f0	User	133	6749.00	monalisa	mumbai	Consumable	projectors	2	2341	2221	2	me	4	pratappur	already present in the iit mandi	\N	\N	\N	\N	2025-09-05 22:50:31.572511	Accepted	Approved	Approved	Approved	\N	\N	f	\N	\N	\N	\N	\N
ab09625a-c8f1-45d1-98c2-93f461fd1563	User	2341	4509.00	MS Dhoni	Jarkhand	Minor	Samsung TV+	4	45000	Virat Kumar	3	IIT Mandi	3	Kamand Mandi	Okay	Costly				2025-09-08 18:01:25.488124	User	\N	Pending	\N	Kartavya	\N	f	\N	\N	\N	\N	\N
210c4f46-10ca-4537-8bbe-cc2dee626cdc	B24119	\N	66666.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	Approved by Finance Admin (By: B24119 at 10/2/2025, 6:42:18 PM)	dvsv (By: B24119 at 10/2/2025, 6:41:32 PM)	vafafvaegvadvavafvaaa (By: B24119 at 10/2/2025, 6:42:00 PM)	\N	\N	2025-10-02 13:11:18.328095	Accepted	Approved	Approved	Approved	asfcaefcawfcawf	\N	f	\N	\N	\N	\N	\N
dcd0649f-f908-4fbb-bb3d-45c3070448a4	b24199	133	58988.00	ffhs	gmn	Major	IPad Pro with Apple Pencil	1	2343	990	1	24	009	dhbsgns	\N	\N	\N	\N	\N	2025-09-05 23:43:26.000407	Student Purchase	Reject	\N	\N	\N	\N	f	\N	\N	\N	\N	\N
0c12c52e-85e6-444e-9aff-a42da6e2fc83	B24119	\N	55555.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	n (By: B24119 at 10/2/2025, 6:08:59 PM)	\N	\N	\N	\N	2025-10-02 12:37:20.667438	Accepted	Approved	Approved	Approved	d	\N	f	\N	\N	\N	\N	\N
de4481f9-10d0-48f6-9174-f173b84a3ae5	B24119	\N	60001.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	kbk (By: B24119 at 10/2/2025, 6:35:25 PM)	\N	jcjvvgkj (By: B24119 at 10/2/2025, 6:34:37 PM)	\N	\N	2025-10-02 13:01:26.893222	Accepted	Approved	Hold	\N	f	\N	f	\N	\N	\N	\N	\N
58ec6e9e-f3d4-4524-8216-5f05e9c5efa5	B24483	ABC	0.00	ABC	Mandi	Major	Mobile	1	12345	Me	1	PDA			\N	\N	\N	\N	\N	2025-09-07 20:21:54.755182	Accepted	\N	Pending	Approved	\N	\N	f	\N	\N	\N	\N	\N
5a2afce5-97a1-4267-9b3c-2e0c155cfe7e	B24119	\N	51111.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	Approved by Finance Admin (By: B24119 at 10/2/2025, 6:47:38 PM)	 c (By: B24119 at 10/2/2025, 6:46:59 PM)	d (By: B24119 at 10/2/2025, 6:47:15 PM)	\N	\N	2025-10-02 13:15:24.758502	Accepted	Approved	Approved	Approved	c	\N	f	\N	\N	\N	\N	\N
b17f87b3-6cbc-407f-8da6-615fa6cd4156	User	Bulk order	4000.00	Naman	Delhi	Minor	Lab instruments	5	None	Hardik	5	Iit	5000	Mandi	No funds for it	\N	\N	\N	\N	2025-09-11 04:50:02.808201	Finance Admin	\N	Approved	Reject	Arjun	\N	f	\N	\N	\N	\N	\N
43352c49-40e0-421c-b91b-6ad62d882a9b	B24119	\N	60000.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	fd (By: B24119 at 10/2/2025, 6:16:54 PM) (By: B24119 at 10/2/2025, 6:20:53 PM)	\N	daa (By: B24119 at 10/2/2025, 6:17:46 PM)	\N	\N	2025-10-02 12:46:37.001127	Accepted	Approved	Approved	Approved	c	\N	f	\N	\N	\N	\N	\N
0bbe779f-76cd-4daa-bf84-212e1f97ef5f	USER	\N	8999.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	ll (By: B24119 at 10/19/2025, 10:42:04 AM)	\N	\N	\N	\N	2025-10-14 14:10:22.788304	User	\N	Approved	Reject	fvpkbn	School of Computing & Electrical Engineering	f	\N	\N	\N	\N	\N
e413757d-f040-4b68-852c-0929a9999331	B24119	\N	75467.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	kk (By: B24119 at 10/2/2025, 6:54:22 PM)	'jm (By: B24119 at 10/2/2025, 6:54:35 PM)	\N	\N	2025-10-02 13:21:55.668531	Student Purchase	Reject	Reject	Hold	f	\N	f	\N	\N	\N	\N	\N
d290dd83-8319-4096-9bc1-bf330258ad7b	B24119	\N	88887.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2025-10-02 13:27:26.397503	Student Purchase	Pending	\N	\N	jj	\N	f	\N	\N	\N	\N	\N
620eb28e-8f0a-4cf7-bc47-a0c4e4f87d75	B24119	\N	55555.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2025-10-02 13:43:47.839426	Student Purchase	Pending	\N	\N	sss	\N	f	\N	\N	\N	\N	\N
2bde58cd-6769-4dfe-b21f-89ea68015f32	B24119	\N	55555.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	cd (By: B24119 at 10/2/2025, 7:17:25 PM) (By: Finance Admin at 11/8/2025, 3:36:49 PM)	\N	\N	\N	\N	2025-10-02 13:44:36.581678	Accepted	Approved	Approved	Approved	dd	\N	f	\N	\N	\N	\N	\N
bec4f31a-acc1-4a3a-9442-4f80627c13f1	B24119	\N	555555.00	\N	\N	Consumables	\N	\N	\N	\N	\N	\N	\N	\N	Approved by Finance Admin (By: B24119 at 10/2/2025, 10:51:26 PM)	\N	\N	\N	\N	2025-10-02 17:20:53.669004	Accepted	\N	Approved	Approved	vs	School of Computing & Electrical Engineering	f	\N	\N	\N	\N	\N
efa48783-a032-4b54-b04d-7bfa30d5c6f2	B24119	\N	55552.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	Approved by Finance Admin (By: B24119 at 10/2/2025, 10:55:48 PM)	efwefwfwf (By: B24119 at 10/2/2025, 6:48:34 PM)	efc (By: B24119 at 10/2/2025, 6:48:50 PM)	\N	\N	2025-10-02 13:18:19.839127	Accepted	Hold	Reject	Approved	f	\N	f	\N	\N	\N	\N	\N
61e7193b-3dd3-4f48-8e8d-17b0dc4d4e2e	B24119	\N	66666.00	\N	\N	Consumables	\N	\N	\N	\N	\N	\N	\N	\N	hh (By: B24119 at 10/3/2025, 10:03:32 AM)	\N	\N	\N	\N	2025-10-02 17:19:48.714208	Student Purchase	Reject	\N	\N	h	\N	f	\N	\N	\N	\N	\N
0f1f4c03-bb0b-4176-8f85-6000d890486f	B24119	\N	77762.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	Gg (By: Student Purchase at 11/10/2025, 11:30:37 AM)	\N	\N	\N	2025-10-15 16:44:31.495841	Student Purchase	Reject	\N	\N	ff	\N	f	\N	\N	\N	\N	\N
e648e59d-7d75-4d9b-84b9-e9fa8c817918	B24119	\N	88888.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2025-10-15 16:38:53.289968	Student Purchase	Pending	\N	\N	ff	\N	f	\N	\N	\N	\N	\N
0e0c7967-69d3-40d8-8482-0e7a0083c8a3	B24119	\N	66631.00	\N	\N	Consumables	\N	\N	\N	\N	\N	\N	\N	\N	Approved by Finance Admin (By: B24119 at 10/14/2025, 7:55:53 PM)	\N	\N	\N	\N	2025-10-14 14:22:17.988377	Accepted	\N	Approved	Approved	B24119	School of Computing & Electrical Engineering	f	\N	\N	\N	\N	\N
c63293a6-293e-488e-96e1-22d7fc495d6b	B24119	\N	41000.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2025-10-15 16:31:22.342325	Student Purchase	Pending	\N	\N	f	\N	f	\N	\N	\N	\N	\N
358fa7cc-1e78-48dd-ad25-cb9e160d9986	B24119	\N	19999.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2025-10-15 16:32:36.899208	Student Purchase	Pending	\N	\N	222	\N	f	\N	\N	\N	\N	\N
6255888c-33b9-490a-9e8c-c0e5f459813f	B24119	\N	60000.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2025-10-15 16:34:18.781032	Student Purchase	Pending	\N	\N	kk	\N	f	\N	\N	\N	\N	\N
0d0d9228-4aed-44f9-8687-2a7270de4e5e	B24119	\N	20000.00	\N	\N	Consumables	\N	\N	\N	\N	\N	\N	\N	\N	Approved by Finance Admin (By: B24119 at 10/14/2025, 7:55:58 PM)	\N	\N	\N	\N	2025-10-14 14:22:01.700651	Accepted	\N	\N	Approved	B24119	School of Computing & Electrical Engineering	f	\N	\N	\N	\N	\N
5285d18e-4caa-4547-9ab6-b976cd8f2806	B24119	\N	40001.00	\N	\N	Major	\N	\N	\N	\N	\N	\N	\N	\N	Approved by Finance Admin (By: B24119 at 10/14/2025, 7:56:03 PM)	\N	\N	\N	\N	2025-10-14 14:21:43.529216	Accepted	Approved	\N	Approved	B24119	School of Computing & Electrical Engineering	f	\N	\N	\N	\N	\N
c6e202d6-0173-4cd6-9e1a-ad8a69978f4f	USER	22	64000.00	arjun	mmk	Minor	vlkf	989	lkvmfl	flbmmp	9	memem	dfpkvm	madni	\N	Yu (By: Student Purchase at 11/10/2025, 8:56:40 AM)	\N	\N	\N	2025-10-14 14:02:16.167647	Student Purchase	Reject	\N	\N	karkar	School of Computing & Electrical Engineering	f	\N	\N	\N	\N	\N
239bf327-a25a-429e-90c3-ff5cd71df5b9	B24119	\N	66600.00	\N	\N	Major	\N	\N	\N	\N	\N	\N	\N	\N	Approved by Finance Admin (By: B24119 at 10/14/2025, 7:56:23 PM)	\N	\N	\N	\N	2025-10-14 14:21:07.337858	Accepted	Approved	Approved	Approved	B24119	School of Computing & Electrical Engineering	f	\N	\N	\N	\N	\N
4b45e21c-0510-4146-b13d-cc8f295e57bf	B24119	\N	66666.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	f (By: B24119 at 10/14/2025, 7:56:36 PM)	\N	\N	\N	\N	2025-10-14 14:20:09.724403	Finance Admin	Approved	Approved	Reject	fsfc	School of Computing & Electrical Engineering	f	\N	\N	\N	\N	\N
a667037a-a0c3-4e7a-9afd-24f86e57a9c5	B24119	\N	50002.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2025-10-20 03:07:00.524555	Student Purchase	Pending	\N	\N	50002	\N	f	\N	\N	\N	\N	\N
f3d33e75-e8d3-4644-81dd-c8376afe5c1c	B24119	ff	1.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2025-10-20 03:13:51.909745	Student Purchase	Pending	\N	\N	ff	\N	f	\N	\N	\N	\N	\N
0915bc29-d6a4-418a-9c1d-f64eecaaf940	B24119	\N	55550.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	hhhh (By: B24119 at 10/2/2025, 6:09:43 PM)	\N	\N	\N	\N	2025-10-02 12:39:32.88524	Finance Admin	Approved	Pending	Pending	c	School of Computing & Electrical Engineering	f	\N	\N	\N	\N	\N
c90e51f8-1661-4491-ba9a-552f35c555da	B24119	\N	66666.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	Ghj (By: Audit at 11/5/2025, 12:24:21 AM)	\N	rr (By: B24119 at 10/20/2025, 10:03:23 AM)	\N	\N	2025-10-20 03:15:54.12235	Finance Admin	Approved	Approved	Reject	vs	\N	f	\N	\N	\N	\N	\N
6b876f1c-2ba7-424b-b0fd-5b200ab99783	B24119	5	5.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2025-10-20 03:19:43.527603	Student Purchase	Pending	\N	\N	5	School of Computing & Electrical Engineering	f	\N	\N	\N	\N	\N
15ec8760-0158-4075-a759-0f42fe11590b	B24119	jj	6.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2025-10-20 03:24:00.430482	Student Purchase	Pending	\N	\N	kk	School of Computing & Electrical Engineering	f	\N	\N	\N	\N	\N
64f7ad1b-791f-4a82-aa7e-6a7ec36112bc	B24119	\N	39999.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	jj (By: B24119 at 10/19/2025, 10:39:25 AM)	\N	\N	\N	\N	2025-10-14 14:21:26.318098	Finance Admin	Approved	Pending	Reject	B24119	School of Computing & Electrical Engineering	t	\N	\N	\N	\N	\N
d890a898-bc61-465a-916d-a70df2e9aa8b	B24119	\N	40000.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2025-10-20 03:02:50.204672	Finance Admin	Approved	\N	Pending	ff	\N	f	\N	\N	\N	\N	\N
df21ff41-4f8d-4308-8c80-7df852f2347e	B24119	\N	6666.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	fafae (By: Finance Admin at 11/10/2025, 2:33:47 PM)	\N	\N	\N	2025-11-10 09:03:23.15269	Student Purchase	Hold	\N	\N	55	School of Computing & Electrical Engineering	f	\N	\N	\N	\N	\N
a9759905-ebdb-4f5d-a0e4-e7a9761b59f0	B24119	2	7.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	sfvfv (By: Finance Admin at 11/4/2025, 11:28:03 PM)	hi (By: B24119 at 10/20/2025, 8:54:44 AM)	\N	wcb (By: B24119 at 10/20/2025, 9:12:22 AM)	lo	2025-10-20 03:19:13.137572	Finance Admin	Approved	\N	Reject	2	School of Computing & Electrical Engineering	t	\N	\N	\N	\N	\N
cf8cd391-c84a-4357-ba6f-15d1492babc9	B24119	\N	999.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	fef (By: B24119 at 10/22/2025, 2:48:10 PM)	\N	Approved by Finance Admin (By: B24119 at 10/22/2025, 2:49:05 PM)	\N	2025-10-22 09:16:15.464896	Accepted	Approved	\N	Approved	fwefadaf	School of Computing & Electrical Engineering	f	\N	\N	\N	\N	\N
883dec9e-e927-4d50-9a27-bffbf5a2d54e	B24119	\N	556.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	not good (By: Finance Admin at 11/10/2025, 3:36:26 PM)	\N	\N	\N	2025-11-10 10:05:46.680337	Student Purchase	Reject	\N	\N	fff	School of Computing & Electrical Engineering	f	\N	\N	\N	\N	\N
58f3ec7e-8801-419d-9838-728aee257a61	B24119	\N	52000.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	kh (By: B24119 at 11/7/2025, 5:09:08 PM)	\N	\N	2025-11-07 11:01:32.366837	Audit	Approved	Hold	\N	fe	School of Computing & Electrical Engineering	f	t		\N	\N	\N
0e5e93b6-b81f-4a98-b748-1e66f1bb198c	B24119	\N	2.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	nkkn (By: B24119 at 11/7/2025, 5:09:59 PM)	\N	\N	\N	\N	2025-11-07 11:09:12.191657	Finance Admin	Approved	\N	Reject	fff	School of Computing & Electrical Engineering	f	f	\N	\N	\N	\N
a5b6a4bf-d931-479e-99a8-582039f2e7c7	B24119	cl	26262.00	\N	\N	Consumables	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	Approved by Finance Admin (By: B24119 at 10/20/2025, 9:58:29 AM)	\N	2025-10-20 04:20:57.636976	Accepted	\N	\N	Approved	cl	School of Computing & Electrical Engineering	f	\N	\N	\N	\N	\N
c64c708f-69a9-4d85-ade6-c453b57ceeaa	B24119	cg	62626.00	\N	\N	Consumables	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	Approved by Finance Admin (By: B24119 at 10/20/2025, 9:59:03 AM)	\N	2025-10-20 04:20:08.251128	Accepted	\N	Approved	Approved	cg	School of Computing & Electrical Engineering	f	\N	\N	\N	\N	\N
6f5d62b2-d7aa-4c58-a28e-4628bd1558d7	B24119	mal	42424.00	\N	\N	Major	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	Approved by Finance Admin (By: B24119 at 10/20/2025, 9:59:08 AM)	\N	2025-10-20 04:19:34.533663	Accepted	Approved	\N	Approved	mal	School of Computing & Electrical Engineering	f	\N	\N	\N	\N	\N
f09b52fc-f890-4ac6-b0b6-51caf3818eed	B24119	mil	40000.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	Approved by Finance Admin (By: B24119 at 10/20/2025, 9:59:16 AM)	\N	2025-10-20 04:18:43.718592	Accepted	Approved	\N	Approved	mil	School of Computing & Electrical Engineering	f	\N	\N	\N	\N	\N
7482090c-0ab5-4da1-a60f-eda6a64ec878	User	\N	55.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	get (By: B24119 at 10/22/2025, 3:10:43 PM)	\N	wrfwefwef (By: B24119 at 10/22/2025, 3:11:52 PM) (By: B24119 at 10/22/2025, 3:12:40 PM)	\N	2025-10-22 09:40:14.31765	Accepted	Approved	\N	Approved	888	School of Computing & Electrical Engineering	f	\N	\N	\N	\N	\N
ff87db8d-9eaf-4e83-902e-63ce1197f0c5	B24119	60k	60000.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	hi	j (By: B24119 at 10/20/2025, 9:34:02 AM)	\N	\N	2025-10-20 03:52:58.238665	Audit	Approved	Reject	\N	60k	School of Physical Sciences	f	\N	\N	\N	\N	\N
c3719cf4-1268-4a4b-998e-31d480bcbbb9	B24119	mig	55554.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	jjl (By: B24119 at 10/20/2025, 10:00:02 AM) (By: B24119 at 10/20/2025, 10:01:24 AM)	\N	2025-10-20 04:18:12.43341	Accepted	Approved	Approved	Approved	mig	School of Computing & Electrical Engineering	f	\N	\N	\N	\N	\N
bff7c6f8-bff7-4bbc-9982-1528fc2f3cfe	B24119	mag	54999.00	\N	\N	Major	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	no (By: B24119 at 10/20/2025, 9:57:42 AM)	Approved by Finance Admin (By: B24119 at 10/20/2025, 10:01:33 AM)	\N	2025-10-20 04:19:10.33537	Accepted	Approved	Approved	Approved	mag	School of Computing & Electrical Engineering	f	\N	\N	\N	\N	\N
5c36da92-b287-4e10-9a50-787be908e8ce	User	\N	61.00	\N	\N	Consumables	\N	\N	\N	\N	\N	\N	\N	\N	hrt (By: B24119 at 11/7/2025, 5:15:57 PM)	\N	\N	\N	\N	2025-11-07 11:45:30.520047	Accepted	\N	\N	Approved	f546686	School of Computing & Electrical Engineering	f	\N	\N	\N	\N	\N
856780d5-6676-4910-9752-893787be5696	User	\N	6.00	\N	\N	Consumables	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	errrrrrrrrrrrr (By: B24119 at 10/22/2025, 9:13:38 PM)	\N	2025-10-22 15:40:17.186675	Finance Admin	\N	\N	Reject	55	School of Computing & Electrical Engineering	t	\N	\N	\N	\N	\N
0cdb3e9f-6b6d-4672-b3ce-d9af1beb2430	B24119	cl	22222.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	jj (By: B24119 at 10/20/2025, 9:58:47 AM)	\N	2025-10-20 04:20:31.321425	Finance Admin	Approved	\N	Reject	cl	School of Computing & Electrical Engineering	t	\N	\N	\N	\N	\N
1083ec4e-6582-462c-813d-ab1f0d0ecf1b	B24119	moigs	66000.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	hh (By: B24119 at 10/20/2025, 10:05:09 AM)	\N	Approved by Finance Admin (By: B24119 at 10/20/2025, 10:06:07 AM)	\N	2025-10-20 04:34:04.085013	Accepted	Approved	Approved	Approved	mig	School of Computing & Electrical Engineering	f	\N	\N	\N	\N	\N
5d8d23fd-1b36-4165-b578-733e0ec1e81b	USER	4433911	67000.00	kg king	mandi	Major	Laptop	3	cheap laptops	karan	3	mandi	3	mandi	nkasjxnkasnx (By: B24119 at 10/19/2025, 10:26:10 AM)	\N	\N	\N	\N	2025-10-15 10:32:43.998767	Finance Admin	Approved	Approved	Reject	kartavya	School of Computing & Electrical Engineering	t	\N	\N	\N	\N	\N
9e124bfc-baf0-4ff7-9364-a6d3b91c0c15	B24119	\N	1111.00	\N	\N	Minor	\N	0	\N	\N	\N	\N	\N	\N	\N	not ok (By: SNP at 10/28/2025, 3:06:59 PM)	\N	\N	\N	2025-10-28 09:33:15.635746	Student Purchase	Reject	\N	\N	b24119	School of Computing & Electrical Engineering	t	\N	\N	\N	\N	\N
c71ac7ff-d7f7-445a-a566-39ce00aaadd6	User	\N	11.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	k (By: B24119 at 11/7/2025, 5:37:36 PM)	\N	\N	\N	2025-11-07 11:44:27.019232	Student Purchase	Hold	\N	\N	4564444444	School of Computing & Electrical Engineering	f	\N	\N	\N	\N	\N
0a4953b7-e8ee-4cad-a29c-576e47acabf9	B24119	\N	1111.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	Approved by Finance Admin (By: Finance Admin at 10/28/2025, 3:47:32 PM)	\N	2025-10-28 10:15:59.304011	Accepted	Approved	Approved	Approved	HH	School of Computing & Electrical Engineering	f	\N	\N	\N	\N	\N
c8f66460-1c88-449f-84c0-95d4b129b1da	User	\N	666.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	Approved by Finance Admin (By: Finance Admin at 11/8/2025, 3:36:42 PM)	\N	\N	\N	\N	2025-10-22 15:46:22.215863	Accepted	Approved	\N	Approved	f	School of Computing & Electrical Engineering	f	\N	\N	\N	\N	\N
415be4fe-4b15-4127-9397-0a1a3ee7fc9f	User	\N	60.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2025-11-07 11:42:39.551401	Finance Admin	Approved	\N	Pending	5	School of Computing & Electrical Engineering	f	f	\N	\N	\N	\N
c5a5b0e5-b287-4bad-a834-d88b32bb83a7	User	\N	2323.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2025-10-22 09:20:56.71798	Finance Admin	Approved	\N	Pending	fef	School of Computing & Electrical Engineering	f	t	J	6.00	2025-11-27 00:00:00	2025-11-10 00:00:00
1be63763-ce76-4a26-9e41-986ecafb994c	B24119	\N	2000.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	wefwef (By: Finance Admin at 11/10/2025, 2:02:48 PM)	\N	\N	\N	2025-11-10 08:32:23.522857	Student Purchase	Reject	\N	\N	m	School of Computing & Electrical Engineering	f	\N	\N	\N	\N	\N
539fc915-8189-4d4d-b094-46c89039df2d	B24119	\N	500.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2025-11-10 08:59:13.905615	Student Purchase	Pending	\N	\N	6	School of Computing & Electrical Engineering	f	\N	\N	\N	\N	\N
b757209c-b9e5-4c3a-861c-a03d8f169469	B24119	\N	88.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	r (By: Finance Admin at 11/10/2025, 2:51:29 PM)	\N	\N	\N	2025-11-10 09:20:48.156516	Student Purchase	Hold	\N	\N	r	School of Computing & Electrical Engineering	f	\N	\N	\N	\N	\N
30420e53-64e5-4f4c-9ddc-974bed8ba5b0	B24119	\N	88.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	frf (By: Finance Admin at 11/10/2025, 2:42:21 PM)	\N	\N	\N	2025-11-10 09:12:08.558865	Student Purchase	Reject	\N	\N	fef	School of Computing & Electrical Engineering	t	\N	\N	\N	\N	\N
df4942c8-8f6b-491b-9d7b-328adb4cd91d	B24119	\N	588.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	ee (By: Finance Admin at 11/10/2025, 2:40:14 PM)	\N	\N	\N	2025-11-10 09:09:58.592646	Student Purchase	Reject	\N	\N	8	School of Computing & Electrical Engineering	t	\N	\N	\N	\N	\N
06ffb9fc-fa1e-4570-98d3-b3112bf0cb57	B24119	kjd	5343.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2025-11-10 10:01:08.862865	Student Purchase	Pending	\N	\N	yud	School of Computing & Electrical Engineering	f	\N	\N	\N	\N	\N
00ad538c-c40e-4046-8995-31ceeaf68190	B24119	\N	55.00	\N	\N	Minor	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2025-11-10 10:04:02.008507	Finance Admin	Approved	\N	Pending	df	School of Computing & Electrical Engineering	f	t	yqwuyq	55.00	2025-11-10 00:00:00	2025-11-14 00:00:00
1ddddd68-fc65-441b-bb67-8534469337f7	B24119	IE	600.00	\N	\N	Major	\N	\N	\N	\N	\N	\N	\N	\N	\N	yuhj (By: User at 11/10/2025, 3:43:18 PM)	\N	\N	\N	2025-11-10 10:10:05.343644	Student Purchase	Pending	\N	\N	YUSI	School of Computing & Electrical Engineering	f	\N	\N	\N	\N	\N
\.

COPY public.employees (id, email, employee_type, created_at, employee_code, employee_name, department) FROM stdin;
5fc9bacc-7922-4273-8b6b-7bb27daed63c	student1@example.com	Student Purchase	2025-09-05 12:09:00.10317	b24192	surya	School of Computing & Electrical Engineering
ade2155c-3f69-4b02-a8b5-8b24eaf50cfb	audit1@example.com	Audit	2025-09-05 12:09:00.10317	b24144	tanamy	School of Computing & Electrical Engineering
Finance Admin\n	1@gmail.com	Finance Admin	2025-09-08 21:25:29	Finance Admin	weaf	School of Computing & Electrical Engineering
pda manager	B24119@students.iitmandi.ac.in	pda-manager	2025-09-05 19:46:30	pda manager	akshit	School of Computing & Electrical Engineering
7bb7640d-bf6d-409e-be1b-c7c086160bab	user2@iitmandi.ac.in	bill_employee_fill	2025-01-02 00:00:00	E002	User Two	School of Computing & Electrical Engineering
407d386e-1dd2-4e6e-917d-1b443b27fee4	user3@iitmandi.ac.in	bill_employee_fill	2025-01-03 00:00:00	E003	User Three	School of Computing & Electrical Engineering
SNP	SNP@gmaii.com	Student Purchase	2025-09-08 21:24:20	Student Purchase	fcwe	School of Computing & Electrical Engineering
15617d59-0b3a-4dc4-b10b-1b9a0729d40f	b24199@gmail,com	bill_employee_fill	2025-09-08 18:25:28.393772	Bill Employee	Clerk	Dashir Hostel
36acf7d2-ea56-406c-a764-bcd9402107ab	b24199@students.iitmandi.ac.in	Finance Admin	2025-09-05 12:09:00.10317	b24199	kartavya	Dean Infrastructure (I&S)/Land Acquisition
B24119	11@gmail.com	bill_employee_fill	2025-11-07 17:41:23	B24119	B24119	School of Computing & Electrical Engineering
Audi	audit@iitmandi.ac.in	Audit	2025-09-08 21:16:06	 Audit	wefwewf	School of Computing & Electrical Engineering
Bill-form	user1@iitmandi.ac.in	bill_employee_fill	2025-01-01 00:00:00	E0324	\N	Advanced Materials Research Center (AMRC)
Bill-edit	Bill-edit@students.iitmandi.ac.in	Finance Employee	2025-10-13 13:24:54.11738	E00	\N	School of Management
6afaa503-eec2-4030-8dae-6b60c8e2f694	EE@gmsil.com	Student Purchase	2025-11-05 13:29:31.939869	B24111	\N	Associate Deans
bbefecd8-9eaa-4df1-9c68-f9bb2a622e13	kgiyjt@njn	Finance Employee	2025-11-10 11:55:07.372348	gkh	gg	Finance and Accounts
4072ade4-ed36-403f-a1ce-8ad22912464c	b24211@students.iitmandi.ac.in	bill_employee_fill	2025-09-05 12:09:00.10317	b24211	\N	School of Computing & Electrical Engineering
\.

COPY public.pda_balances (id, employee_id, balance, updated_at, department, email) FROM stdin;
c493f17e-e909-411c-aba5-4e1555f86287	user2	50000.00	2025-11-10 13:09:41.316	School of Computing & Electrical Engineering	B24119@gmail.com
20efc7da-78c8-48c3-86d9-e6705206c550	User	50000.00	2025-11-10 13:09:41.316	School of Computing & Electrical Engineering	B24119@gmail.com
f1bf8f7d-6e44-4e34-9515-8970266df1ac	B24119	50000.00	2025-11-10 13:09:41.316	School of Computing & Electrical Engineering	B24119@students.iitmandi.ac.in
7999e5e3-dfc5-4d4a-bc91-95872426e6d0	B24199	50000.00	2025-11-10 13:09:41.316	School of Computing & Electrical Engineering	B24119@students.iitmandi.ac.in
e8ea8ba5-145c-403d-8103-f07a1a412548	USER	50000.00	2025-11-10 13:09:41.316	School of Management	B24119@gmail.com
\.
