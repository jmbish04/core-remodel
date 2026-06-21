-- Seed: SF independent drafters from DBI permit analysis (i98e-djp9 + 3pee-9qhc)
-- Data-only INSERTs. Run AFTER `pnpm run db:generate` + migrate.
DELETE FROM prospects;
INSERT INTO prospects (id,rank,first_name,last_name,full_name,firm,roles,permit_count,avg_cost,median_cost,scope_keywords,is_unbundled_candidate,collision_risk,phone,phone_source,email,email_source,website,contact_status,license_note,call_script) VALUES
('tony-lee',1,'Tony','Lee','Tony Lee',NULL,'architect / designer',120,232864,210000,'bath, full kitchen, remodel, rear',1,1,NULL,NULL,NULL,NULL,NULL,'needs_research','Very common name with 120 permits — almost certainly MULTIPLE different people merged. Confirm exactly who filed permits near your block before trusting this as one person.','Hi, is this Tony? My name''s Justin — I''m a homeowner doing a kitchen remodel here in San Francisco that involves opening up a structural wall and correcting a plumbing defect in the main waste stack.

I''ll be upfront about how I found you: I went through the SF DBI permit database, and your name came up on roughly 120 single-family kitchen & bath remodel permits over the last couple of years — which is almost exactly the scope I''m about to file.

My situation: I already have my general contractor and a structural engineer lined up. The piece I''m missing is the drawings — I''m not after full-service design, I need a clean, permit-ready set I can move through DBI quickly.

Two quick questions: do you take permit-only / unbundled drafting work, and would you have capacity to start in the next few weeks?

If it could be a fit, I''d love to send over the scope and the engineer''s prelim — what''s the best email for that?'),
('arten-chan',2,'Arten','Chan','Arten Chan','Tommy Lee Consulting','designer / permit expediter',50,152350,182189,'bathroom, kitchen, remodel, relocate, laundry',1,0,NULL,NULL,NULL,NULL,NULL,'needs_research','Designer + permit expediter — a strong unbundled / permit-only profile. SF permit consultants must register with the SF Ethics Commission; you can verify there.','Hi, is this Arten? My name''s Justin — I''m a homeowner doing a kitchen remodel here in San Francisco that involves opening up a structural wall and correcting a plumbing defect in the main waste stack.

I''ll be upfront about how I found you: I went through the SF DBI permit database, and your name came up on roughly 50 single-family kitchen & bath remodel + relocation permits over the last couple of years — which is almost exactly the scope I''m about to file.

I also saw you do permit expediting — honestly, someone who can walk the set through DBI is exactly what I''m after.

My situation: I already have my general contractor and a structural engineer lined up. The piece I''m missing is the drawings — I''m not after full-service design, I need a clean, permit-ready set I can move through DBI quickly.

Two quick questions: do you take permit-only / unbundled drafting work, and would you have capacity to start in the next few weeks?

If it could be a fit, I''d love to send over the scope and the engineer''s prelim — what''s the best email for that?'),
('ken-chan',3,'Ken','Chan','Ken Chan','CBS Construction Inc. / Ken Chan','architect / designer / permit expediter',41,184908,182000,'bathroom, kitchen, construct, remodel, replace',1,1,NULL,NULL,NULL,NULL,NULL,'needs_research','Carries all three design roles (incl. expediter). Common name — confirm identity. Associated with CBS Construction Inc.','Hi, is this Ken? My name''s Justin — I''m a homeowner doing a kitchen remodel here in San Francisco that involves opening up a structural wall and correcting a plumbing defect in the main waste stack.

I''ll be upfront about how I found you: I went through the SF DBI permit database, and your name came up on roughly 41 single-family kitchen & bath remodel permits over the last couple of years — which is almost exactly the scope I''m about to file.

I also saw you do permit expediting — honestly, someone who can walk the set through DBI is exactly what I''m after.

My situation: I already have my general contractor and a structural engineer lined up. The piece I''m missing is the drawings — I''m not after full-service design, I need a clean, permit-ready set I can move through DBI quickly.

Two quick questions: do you take permit-only / unbundled drafting work, and would you have capacity to start in the next few weeks?

If it could be a fit, I''d love to send over the scope and the engineer''s prelim — what''s the best email for that?'),
('bill-guan',4,'Bill','Guan','Bill Guan','Xie Associates','architect',32,225514,184926,'remodel, kitchen, bathroom, bedroom, stair',0,0,NULL,NULL,NULL,NULL,NULL,'needs_research','Architect at Xie Associates (small firm — Xie Guan also files under it). Licensed architect: verify on CA Architects Board.','Hi, is this Bill? My name''s Justin — I''m a homeowner doing a kitchen remodel here in San Francisco that involves opening up a structural wall and correcting a plumbing defect in the main waste stack.

I''ll be upfront about how I found you: I went through the SF DBI permit database, and your name came up on roughly 32 single-family kitchen & bath remodel permits over the last couple of years — which is almost exactly the scope I''m about to file.

Your studio looks focused on single-family remodels with design straight through permitting, which is a strong match for what I need.

My situation: I already have my general contractor and a structural engineer lined up. The piece I''m missing is the drawings — I''m not after full-service design, I need a clean, permit-ready set I can move through DBI quickly.

Two quick questions: do you take permit-only / unbundled drafting work, and would you have capacity to start in the next few weeks?

If it could be a fit, I''d love to send over the scope and the engineer''s prelim — what''s the best email for that?'),
('bin-lei',5,'Bin','Lei','Bin Lei','Bin Lei (solo)','architect / designer / permit expediter',29,101594,70000,'room, bathroom, remodel, kitchenette, bedroom',1,0,NULL,NULL,NULL,NULL,NULL,'needs_research','Solo operator, all three design roles, lower cost band ($70-100k) — the ''hard to come by'' unbundled profile you described. No web presence found; verify via DBI permit PDF contact info.','Hi, is this Bin? My name''s Justin — I''m a homeowner doing a kitchen remodel here in San Francisco that involves opening up a structural wall and correcting a plumbing defect in the main waste stack.

I''ll be upfront about how I found you: I went through the SF DBI permit database, and your name came up on roughly 29 single-family kitchen & bath remodel permits over the last couple of years — which is almost exactly the scope I''m about to file.

You don''t have much of a web presence, so the permit records were how I found you — which usually means you stay busy on word of mouth.

My situation: I already have my general contractor and a structural engineer lined up. The piece I''m missing is the drawings — I''m not after full-service design, I need a clean, permit-ready set I can move through DBI quickly.

Two quick questions: do you take permit-only / unbundled drafting work, and would you have capacity to start in the next few weeks?

If it could be a fit, I''d love to send over the scope and the engineer''s prelim — what''s the best email for that?'),
('aaron-lim',6,'Aaron','Lim','Aaron Lim','Aaron Lim Design','architect',28,138108,100000,'remodel, kitchen, exterior, bath',0,0,NULL,NULL,'aaron@aaronlimdesign.com','First-party — aaronlimdesign.com/contact','https://aaronlimdesign.com','partial','VERIFIED: Licensed CA architect, SF native, studio focused on single-family additions/remodels with design + permitting + construction admin. Cooper Union B.Arch 2008. Phone not published — email is the listed contact.','Hi, is this Aaron? My name''s Justin — I''m a homeowner doing a kitchen remodel here in San Francisco that involves opening up a structural wall and correcting a plumbing defect in the main waste stack.

I''ll be upfront about how I found you: I went through the SF DBI permit database, and your name came up on roughly 28 single-family kitchen & exterior remodel permits over the last couple of years — which is almost exactly the scope I''m about to file.

Your studio looks focused on single-family remodels with design straight through permitting, which is a strong match for what I need.

My situation: I already have my general contractor and a structural engineer lined up. The piece I''m missing is the drawings — I''m not after full-service design, I need a clean, permit-ready set I can move through DBI quickly.

Two quick questions: do you take permit-only / unbundled drafting work, and would you have capacity to start in the next few weeks?

If it could be a fit, I''d love to send over the scope and the engineer''s prelim — what''s the best email for that?'),
('francisco-matos',7,'Francisco','Matos','Francisco Matos','Architects SF','architect',23,126734,76770,'kitchen, bathroom, remodel, wall, interior',0,0,NULL,NULL,NULL,NULL,NULL,'needs_research','Files under ''Architects SF''. Note his scope keywords explicitly include ''wall'' — relevant to your wall-opening. Verify license/contact.','Hi, is this Francisco? My name''s Justin — I''m a homeowner doing a kitchen remodel here in San Francisco that involves opening up a structural wall and correcting a plumbing defect in the main waste stack.

I''ll be upfront about how I found you: I went through the SF DBI permit database, and your name came up on roughly 23 single-family kitchen, bath & wall work permits over the last couple of years — which is almost exactly the scope I''m about to file.

Your studio looks focused on single-family remodels with design straight through permitting, which is a strong match for what I need.

My situation: I already have my general contractor and a structural engineer lined up. The piece I''m missing is the drawings — I''m not after full-service design, I need a clean, permit-ready set I can move through DBI quickly.

Two quick questions: do you take permit-only / unbundled drafting work, and would you have capacity to start in the next few weeks?

If it could be a fit, I''d love to send over the scope and the engineer''s prelim — what''s the best email for that?'),
('xie-guan',8,'Xie','Guan','Xie Guan','Xie Associates','architect',23,205048,200000,'remodel, bathroom, kitchen, bath, rear',0,0,NULL,NULL,NULL,NULL,NULL,'needs_research','Principal-level at Xie Associates (Bill Guan also files here). Higher cost band (~$200k) — leans larger jobs. Verify on CA Architects Board.','Hi, is this Xie? My name''s Justin — I''m a homeowner doing a kitchen remodel here in San Francisco that involves opening up a structural wall and correcting a plumbing defect in the main waste stack.

I''ll be upfront about how I found you: I went through the SF DBI permit database, and your name came up on roughly 23 single-family kitchen & bath remodel permits over the last couple of years — which is almost exactly the scope I''m about to file.

Your studio looks focused on single-family remodels with design straight through permitting, which is a strong match for what I need.

My situation: I already have my general contractor and a structural engineer lined up. The piece I''m missing is the drawings — I''m not after full-service design, I need a clean, permit-ready set I can move through DBI quickly.

Two quick questions: do you take permit-only / unbundled drafting work, and would you have capacity to start in the next few weeks?

If it could be a fit, I''d love to send over the scope and the engineer''s prelim — what''s the best email for that?'),
('dong-liang',9,'Dong','Liang','Dong Liang','Don Liang (solo)','designer',19,83419,50000,'bath, remodel, kitchen, full, relocate',1,0,NULL,NULL,NULL,NULL,NULL,'needs_research','Solo designer, lowest cost band ($50-83k) — fits smaller single-family alterations like yours. No web presence; the ''lives in the DBI database'' profile. Verify via permit PDF.','Hi, is this Dong? My name''s Justin — I''m a homeowner doing a kitchen remodel here in San Francisco that involves opening up a structural wall and correcting a plumbing defect in the main waste stack.

I''ll be upfront about how I found you: I went through the SF DBI permit database, and your name came up on roughly 19 single-family kitchen & bath remodel permits over the last couple of years — which is almost exactly the scope I''m about to file.

You don''t have much of a web presence, so the permit records were how I found you — which usually means you stay busy on word of mouth.

My situation: I already have my general contractor and a structural engineer lined up. The piece I''m missing is the drawings — I''m not after full-service design, I need a clean, permit-ready set I can move through DBI quickly.

Two quick questions: do you take permit-only / unbundled drafting work, and would you have capacity to start in the next few weeks?

If it could be a fit, I''d love to send over the scope and the engineer''s prelim — what''s the best email for that?'),
('tien-chu',10,'Tien','Chu','Tien Chu','T-Square Design LLC / ICE Design & Engineering','architect / designer',18,193597,218000,'bath, kitchen, replace, door, relocate',0,0,NULL,NULL,NULL,NULL,NULL,'needs_research','Files under T-Square Design LLC and ICE Design & Engineering. Architect + designer. Verify license/contact.','Hi, is this Tien? My name''s Justin — I''m a homeowner doing a kitchen remodel here in San Francisco that involves opening up a structural wall and correcting a plumbing defect in the main waste stack.

I''ll be upfront about how I found you: I went through the SF DBI permit database, and your name came up on roughly 18 single-family kitchen & bath remodel permits over the last couple of years — which is almost exactly the scope I''m about to file.

Your studio looks focused on single-family remodels with design straight through permitting, which is a strong match for what I need.

My situation: I already have my general contractor and a structural engineer lined up. The piece I''m missing is the drawings — I''m not after full-service design, I need a clean, permit-ready set I can move through DBI quickly.

Two quick questions: do you take permit-only / unbundled drafting work, and would you have capacity to start in the next few weeks?

If it could be a fit, I''d love to send over the scope and the engineer''s prelim — what''s the best email for that?'),
('katherine-fontaine',11,'Katherine','Fontaine','Katherine Fontaine','Actually Design Build','architect / designer',17,136218,100000,'rear, kitchen, bathroom, wall, remodel, replace',0,0,'(415) 243-6701','Manta directory listing — UNVERIFIED, confirm before dialing',NULL,NULL,'https://www.actuallydesignbuild.com','partial','VERIFIED firm: Katherine Fontaine, founder of Actually Design Build (with Charlie Vaughan) — holds BOTH architectural + contractor licenses, 50+ SF home renovations, scope includes ''wall''. It''s a full design-build shop, so for a permit-only set you''d be asking them to unbundle. Phone is directory-sourced — verify.','Hi, is this Katherine? My name''s Justin — I''m a homeowner doing a kitchen remodel here in San Francisco that involves opening up a structural wall and correcting a plumbing defect in the main waste stack.

I''ll be upfront about how I found you: I went through the SF DBI permit database, and your name came up on roughly 17 single-family kitchen, bath & wall work permits over the last couple of years — which is almost exactly the scope I''m about to file.

I know your shop does full design-build — since I already have a GC, I''d really just be after the permit drawings, but I''m open to how you''d structure something that focused.

My situation: I already have my general contractor and a structural engineer lined up. The piece I''m missing is the drawings — I''m not after full-service design, I need a clean, permit-ready set I can move through DBI quickly.

Two quick questions: do you take permit-only / unbundled drafting work, and would you have capacity to start in the next few weeks?

If it could be a fit, I''d love to send over the scope and the engineer''s prelim — what''s the best email for that?'),
('tommy-lee',12,'Tommy','Lee','Tommy Lee','Tommy Lee Consulting','architect / designer',17,150054,150000,'bathroom, kitchen, relocate, remodel, bedroom',1,1,NULL,NULL,NULL,NULL,NULL,'needs_research','Runs Tommy Lee Consulting (Arten Chan also files under it — likely the same shop). Common name; confirm identity. Couldn''t find a first-party site/phone — verify via the consulting firm or DBI permit contact.','Hi, is this Tommy? My name''s Justin — I''m a homeowner doing a kitchen remodel here in San Francisco that involves opening up a structural wall and correcting a plumbing defect in the main waste stack.

I''ll be upfront about how I found you: I went through the SF DBI permit database, and your name came up on roughly 17 single-family kitchen & bath remodel permits over the last couple of years — which is almost exactly the scope I''m about to file.

I also saw you do permit expediting — honestly, someone who can walk the set through DBI is exactly what I''m after.

My situation: I already have my general contractor and a structural engineer lined up. The piece I''m missing is the drawings — I''m not after full-service design, I need a clean, permit-ready set I can move through DBI quickly.

Two quick questions: do you take permit-only / unbundled drafting work, and would you have capacity to start in the next few weeks?

If it could be a fit, I''d love to send over the scope and the engineer''s prelim — what''s the best email for that?');
