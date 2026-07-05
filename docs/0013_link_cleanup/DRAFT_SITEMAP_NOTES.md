Public / entry
/ — home
/access — auth/access gate
[DELETE] /gallery


PLAN 

Project workspace
[UPDATE] /planning [ADMIN] [move to admin/pmo/operations]
[UPDATE] /admin/contractor-schedule [ADMIN] [move to admin/pmo/schedule/contractor]
[UPDATE] /daily-log [CONTRACTOR] [move to /log/daily]
[UPDATE] /weekly-log [CONTRACTOR] [move to /log/weekly]
[UPDATE] /measure [ADMIN] [move to /admin/planning/measure]
[UPDATE] /measurements [CONTRACTOR] [move to /specs/measurements]
[UPDATE] /questionnaire/ [ADMIN] [move to /admin/planning/questionnaire] [UPDATE THE ROUTE AND THEN HOLD FOR NOW, POTENTIALLY DELETE]
[UPDATE] /questionnaire/[section_slug] [ADMIN] [move to /admin/planning/questionnaire/[section_slug]] [UPDATE THE ROUTE AND THEN HOLD FOR NOW, POTENTIALLY DELETE]
[UPDATE] /questionnaire/print [CONTRACTOR] [UPDATE THE ROUTE AND THEN HOLD FOR NOW, POTENTIALLY DELETE]
[UPDATE] /uploads [ADMIN] [move to /admin/prepare/uploads] [this is a generic file upload page]
[UPDATE] /review [ADMIN] [move to /admin/prepare/review] [this is a generic file review page]

[NEW] /docs [CONTRACTOR] its a list view of the documents that have been marked as public with filters and search capabilities (including by save view / bucket)
[NEW] /docs/view/[id] [CONTRACTOR] [this is a saved view where an ADMIN has created a saved view that will capture documents in a 'bucket' so that they can easily be identifie ]
[NEW] /docs?search=[search query] [CONTRACTOR] [any searches or filters applied by the user will be persisted in the url so that the url can be shared or bookmarked]
[NEW] /docs/[id] [CONTRACTOR] [this page is where the user will be able to view the document -- using /pdf-viewer as the base, and an image being viewed in iframe if an image (hosted by cloudflare images), and if another type of file that cannot be previewed (like a CAD file) then we would display a message with metadata about the file and an option to click download to have it download ]

[NEW] /admin/docs [ADMIN] its a list view of ALL documents with filters and search capabilities (including by save view / bucket)
[NEW] /admin/docs/upload [ADMIN]  [This is the page where the admin will go to manually upload documents to the system  -- this should allow for dropzone and file browser of MULTIPLE documents -- and it should be capable of processing the documents to pull out all internal metadata, extract searchable text (or OCR with visionai), upload to R2, store in d1 with r2 keys, run embeddings and vectorize, and before uploading -- it should list the documents added to the dropzone and allow the user to specify document type ENUM, a title for the document, description, and or tags, whether there are any associations to make with a company_id (contractor), showroom_id, product_id, brand_id, etc] [take note that this should be resuable for instances like `/admin/companies/[id]/documents/upload` where by its the same process of bulk upload and staging for metadata fill in by user .. but in instnces like `/admin/companies/[id]/documents/upload` .. then the associations would be auto set to `company_id` since the photos were being uploaded from `company` viewport ... so this needs to be installed and supported for `/admin/companies/[id]` ... `/admin/showroom/[id]` ... `/admin/products/[id]` ... `/admin/brands/[id]` ... and potentially for project specific uploads like `/admin/projects/[id]/documents/upload`] [on this upload metadata enrichment stage, another field to toggle for each document is whether the document is to be viewable/accessible by the contractor or if the document is private and only accessible by the admin] [by default, all documents uploaded should be default to visibility:private as a safety measure]
[NEW] /admin/docs/permissions [ADMIN] -- [allows admins to bulk select documents and toggle the switch of whether the docs are visible to contractors (and which contractors) or if the documents are visible only to the admin]
[NEW] /admin/docs/view/[id] [ADMIN] [this is a saved view where an ADMIN has created a saved view that will capture documents in a 'bucket' so that they can easily be identifie ]
[NEW] /admin/docs/view/new [ADMIN] [this interface allows the user to create a saved document collection/view as a static collection (admin must manually add documents -- but can do so in bulk) or a dynamic view (whereby the admin toggles the filters and search terms so that if those criteria are met when the view is accessed via /admin/docs/view/[id] then the documents are considered part of the collection, pending permissions of each document of course) that automatically includes/excludes based on criteria -- the admin can also toggle permission on the view which supercedes the individual permissions of the document level -- so a document can be marked hidden from contractor but if that hidden from contractor document is contained within a view that is set as ok for contractor eyes, then that document shall be shown to the contractor but only via that view ... so if the contractor has navigated to `docs/view/[id]` then the hidden document will be visible .. but outside o f that view, the document would remain hidden from the contractor -- there shoul dbe warnings shown using shadcn alert component in amber color to inform the admin when configuring view visibility that there is a potential risk of exposure of hidden document (on dynamic, unless the admin adds a filter for visibility:public as part of the criteria which would respect the underlying docs permissions) or an alert when its confirmed that the view already contains a document(s) that is private but being forced to public due to the visibility setting on the view]
[NEW] /admin/docs?search=[search query] [ADMIN] [any searches or filters applied by the user will be persisted in the url so that the url can be shared or bookmarked]
[NEW] /admin/docs/[id] [ADMIN] [this page is where the user will be able to view the document -- using /pdf-viewer as the base, and an image being viewed in iframe if an image (hosted by cloudflare images), and if another type of file that cannot be previewed (like a CAD file) then we would display a message with metadata about the file and an option to click download to have it download ]
[NEW] /admin/docs/[id]/edit [ADMIN] [this page is where the user will be able to edit the document metadata including document name, tags, type ENUM, etc -- as well as document visibility and if making document public is it public to anyone or only certain contractors? ]



[DELETE] /supporting-docs
[DELETE] /docs/[audience]/[slug] 
[DELETE] /docs/homeowners/permits

Rooms & floor plan
[NO CHANGE] /floor-plan [CONTRACTOR]
[UPDATE] /rooms/[slug] [CONTRACTOR] [move to /floor-plan/floors/[id]/rooms/[id]]
[UPDATE] /rooms/beta/[slug] [CONTRACTOR] [move to /floor-plan/floors/[id]/rooms/[id]]
[UPDATE] /rooms/closets [CONTRACTOR] [move to /floor-plan/floors/[id]/rooms/[id]] [this will show all closets]


AI image / design (the workshop surfaces today)

[UPDATE] /listing-photos [CONTRACTOR] [move to photos/listing]
[UPDATE] /inspiration-photos [CONTRACTOR] [move to photos/inspiration]


/moodboards [ADMIN] [move to admin/design/moodboards] [this page will list all of the style mood boards for the entire project -- groups by floor and room -- filters and searching empowered]
[NEW] /admin/design/moodboards/floors/[id] [ADMIN] [shows all the moodboards for the given floor grouped by roomId -- filters adn searching empowered]
[NEW] /admin/design/moodboards/floors/[id]/room/[id] [ADMIN] [shows all the moodboards for the given floorId and roomId -- filters adn searching empowered]
[NEW] /admin/design/moodboards/new [ADMIN] [this is where the user will be able to create a new mood board and as part of that will involve specifying room(s) and/or floor(s) along with other details that the ai model can help to fill in but user should be able to store their own notes against the moodboard as well] [this process should allow the user to choose from inspiration photos by providing modal to select the inspiration photos via filtering and browsing etc -- the user can add an inspiration photo which will hold that inspiration photo in a queue locally on browser cache so that the user is not worried about accidently unselecting a photo and having to start again ... the user should be able to select as much as 10 photos which is the max that gemini nano bananna allows for reference  [the user can also upload inspiration photos from here via a file dropzone which will process the uploads through the /admin/uploads process for inspiration photos] -- from here, the next step will be to list all the reference inspo images selected and the user will be provided with masking tools and a prompt plateJS [which would capture markdown format] that are both optional in case the user wanted to preface what they wanted gemini to understand / extract / focus on from each selected photo so that while gemini is generating the mood board via referencing the images, gemini can see exactly what the user wanted gemini to focus on --- once the user has added any optional masking / prompt context to the selected reference photos then the user would click a button to attach those reference images to the moodboard chat request ... then the user would have the opportunity to instruct gemini on how to create the mood board ... but this is optional because the system would pre-fill the prompt platejs editor with a default prompt and the user can optionally modify this prompt so it works for their use case -- the user can continue to iterate with gemini until the optimal mood board has been provided at which time the user will click accept and this moodboard item would be registered in the system]
[NEW] /admin/design/moodboards/upload [ADMIN] [this is where the user will be able to bulk upload via a file dropzone mood board(s) created outside of the system or found online that the user wants to bring into their collection -- this should be structured so that the user can easily browse and select from the uploaded images and and as part of that will involve specifying room(s) and/or floor(s) along with other details that the ai model can help to fill in but user should be able to store their own notes against the moodboard as well -- for every moodboard uploaded, the system should collect the same information as /admin/design/moodboards/new so that in the end, there is all the same type of information provided]
[NEW] /admin/design/moodboards/[id] [ADMIN] [this page is where the user will be able to view the mood board]
[NEW] /admin/design/moodboards/[id]/revisions [ADMIN] [this page will list all of the mood board revisions .. this page will have a button to create a new revision]
[NEW] /admin/design/moodboards/[id]/revisions/new [ADMIN] [this is where the user will be able to create a new revision]

[UPDATE] /admin/blank-canvas [ADMIN] [move to admin/prepare/blank-canvas] [lots of lost functionality here -- supposed to have ability to bulk select and exclude photos non relevant for rendering so no blank canvas -- this page should not have any photos marked excluded and should not have any photos that have been paired with a blank canvas]
[NEW] /admin/blank-canvas/upload [ADMIN] [again this is missing functionality i just recently added -- on th main blank-canvas page the user should be able to select multiple rooms pending a blank pairing .. then a wizard appears with a dropzone to drop multiple photos to which thn allows the user to map blank canvas photos to each room so the pariing is formed]
[NEW] /admin/blank-canvas/generate [ADMIN] [again this is missing functionality i just recently added -- on th main blank-canvas page the user should be able to select multiple rooms pending a blank pairing .. then a wizard appears walking through each photo with masking tools and pre-filled prompt that can be customized then the user can send to gemini to blank a listing photo and the user can iterate until finally accepting the ai edited blank result]
[NEW] /admin/blank-canvas/floor/[id] [ADMIN] [This will activate the tab for lower level, upper level, outside]
[NEW] /admin/blank-canvas/floor/[id]/room/[id] [ADMIN] [this will actually activate the floor tab (lower level, upper level, garage) and then only show the specified room -- helpful when the page is heavy -- would be great to have next and back buttons so the user can go from room to room ]
[NEW] /admin/blank-canvas/exclusions [ADMIN] [This was functionality that previously existed on this page where photos could be marked as excluded from having a blank canvas photo becausew would never render from that photo, like we would never render from an electrical panel so we would exclude it by selecting in bulk from /admin/blank-canvas and clicking exclude button -- so this page should list the excluded images with option of un-excluding them -- and this page should not show any non-excluded]
[UPDATE] /builder — Renovation Studio (staged render pipeline) [ADMIN] [move to admin/prepare/blank-canvas/angles] [this is where the user will be able to stitch together a room that has multiple photos so that there is registered context around what areas the photo is capturing so that with this data, an entire room could be rendered on a single photo edit session with consistency in how the images are being stitched given the same prompt but adjusted prompt based on the angles data configured from this page -- The system would list rooms here that have multiple blank canvas photos and the user would select a room and it would then bring up all of the blank canvas photos ... and the user would cycle through each blank canvas photo to position the camera on the floorplan image to show case what is within the field of view in the blank canvas photo so that this camera perspective is understood about where the camera was positioned and what it was facing to produce the given blank canvas photo -- the user will then also provide context in plateJS to specify the details of a pre-filled template questioare for what the user should answer with] 

[DELETE] /photo-edits [DELETE] [this used to be the ai photo editor but we are upgrading it to /admin/design/workshop as the frontdoor to repo https://github.com/qzh3722/awesome-nano-banana-spatial-design]
[NEW] /admin/design/workshop [ADMIN] [this page is the frontdoor to the https://github.com/qzh3722/awesome-nano-banana-spatial-design repo ] [CLAUDE's PLAN SHOULD FILL IN HERE]
[NEW] /admin/design/decision-room [ADMIN] [this is where the user will be able to see a template for the decisions they must make for every room of the house -- the user will choose their final mood board for each room ... (a mood board can apply to multiple rooms) additionally, each room has a fk to the materials record d1 record for things like drywall, plumbing fixtures, etc ... so those materials will be surfaced on the page for each room as todo items where the user must associate material todos with a product such a plumbing with plumbing products, paint with paint color from a brand/product, etc -- while some of these items like drywall design decision will just be details that are filled in and not necessarily point back to a product -- so on each material todo item, from this viewport, the user will toggle whether the material todo should be pointing to a product_id (fk) or if the material item should just point to a clear written description and budget for the non-product decision [aka, budget for floating the drywall in terms of labor, etc]]
[UPDATE] /kitchen-layout [CONTRACTOR] [move to /admin/designs/layouts/[id]] 

[NEW] /planning/design-master-plan [CONTRACTOR] (this will be the final design proposal which will be displayed very professionally with high touch design look and feel -- reading from the /admin/design/decision-room configurations )
[DELETE] /admin/planning/decision-room [this has been repurposed under the /admin/design/.. namespace]
[DELETE] /admin/planning/moodboards · [DELETE] [this became /admin/design/moodboards]
[DELETE] /admin/planning/moodboards/[slug] [DELETE] [this became /admin/design/moodboards]

Budget & bids
[UPDATE] /budget-dashboard · [Admin] [move to /admin/budget/dashboard]
[UPDATE] /budget-tracker · [Admin] [move to /admin/budget/tracker]
[UPDATE] /admin/truth-table [Admin] [move to /admin/budget/truth-table]
[UPDATE] /budget-reconciliation · [Admin] [move to /admin/budget/reconciliation] [Currently not linked on sidebar ... is this different from SEED HOMEOWNER PLAN button from budget-tracker?]
[UPDATE] /bid [Contractor] [Requires Pin immediately upon access unless cookies have been installed because of auth login before -- each contractor receives their own pin ]
[UPDATE] /bid/[token] —[Contractor] [This is a static url to a bid that belongs to a specific contractor as has been configured in /admin/bid-portofolios by ADMIN... so the contractor will receive this link that is specific to them which will ask the contractor to authenticate if the cookie is expired for their login which is also a specific token to the contractor]
[UPDATE] /bid-portfolios · [Admin] [move to /admin/bids] [Manage the bid portfolios to do things like set pins, check on progress of contractor review, etc.]
[UPDATE] /bid-portfolios/new · [Admin] [move to /admin/bids/new] [Creates new bid, configures it, set the bid up for a specific contractor contact from the companies d1 table where contacts are saved and will also configure a dedicated login token for the contractor which is likely just their phone number]
[DELETE] /admin/estimates · [Admin] [This can probably be condensed into /bid-portfolios because estimates are what will be received from contractors /bid page]
[UPDATE] /admin/estimates/new [Admin] [move to /admin/bids/new] [This is where an admin will have to manually fill in a bid/estimate if the contractor refuses to use the /bid viewport and just emails over a bid/estimate] [should continue living as a button on /admin/estimates]

[UPDATE] /admin/companies/ · [Admin] [This is for any general contractor or sub contractor that we are considering hiring or that we do hire]
[NEW!] /admin/companies/new [Admin] [This is where the admin will go to create a new company... it should include a form to fill in all of the company information and then generate a token for the contractor]
[UPDATE]/admin/companies/[id] [Admin] [Should be like a company details page with tabs or sections for contact info, company info like the website, instagram, and CSLB license if applicable -- along with the types of license that this company holds]

[NEW!] /admin/companies/[id]/contacts [Admin] [This is where the admin will go to see all contacts associated with a specific company -- for now there should just be a button to add a new contact]
[NEW!] /admin/companies/[id]/contacts/new [Admin] [This is where the admin will go to create a new contact for a specific company]
[NEW!] /admin/companies/[id]/notes/ [Admin] [This is where the admin will go to view all notes associated with a specific company -- this should be a table of notes that can be filtered by date, author, keyword searching, etc -- note is created in PlateJS]
[NEW!] /admin/companies/[id]/notes/new [Admin] [This is where the admin will go to create a new note for a specific company -- this should open a new plateJS editor page with the company id as part of the url]
[NEW!] /admin/companies/[id]/notes/[id]/view [Admin] [This is where the admin will go to view a specific note -- this is where the user will be able to view the note as (note content as HTML)]
[NEW!] /admin/companies/[id]/notes/[id]/edit [Admin] [This is where the admin will go to edit a specific note -- which would allow the user to edit the  note in plateJs or to change the note status as closed etc -- or to (soft -- isActive:false) delete the note]
[NEW!] /admin/companies/[id]/todos/ [Admin] [This is where the admin will go to view all tasks associated with a specific company -- this should be a table of todos that can be filtered by date, author, keyword searching, etc -- todo is created in PlateJS]
[NEW!] /admin/companies/[id]/todos/new [Admin] [This is where the admin will go to create a new todo for a specific company -- this should open a new page with a plateJS editor to create the todo and fields to enter the todo's due date, and status, and tags, and assigned todo owner -- with date recorded being the date it was created automatically] 
[NEW!] /admin/companies/[id]/todos/[id]/view [Admin] [This is where the admin will go to view a specific todo -- this is where the user will be able to view the todo as (todo content as HTML), the date recorded, date due, todo owner, and todo status, and todo tags]
[NEW!] /admin/companies/[id]/todos/[id]/edit [Admin] [This is where the admin will go to edit a specific todo -- which would allow the user to edit the  todo in plateJs or to change the todo status as closed etc -- or to (soft -- isActive:false) delete the todo]
[NEW!] /admin/companies/[id]/emails [Admin] [This should be a shadcn email inbox block template that looks like an email inbox and is pulling out emails from Gmail by searching for the contractors email domain (if all contacts email domain are the same like bob@contractor-acme.com -- then this would search Gmail for `@contractor-acme.com` and automatically pull in all email // if each contact has a different email like @hotmail.com, @gmail.com  etc .. then this service would search for the actual full emails and pull anything in)
[NEW!] /admin/companies/[id]/emails/[threadId] [Admin] [This is the threadId passed in from Gmail API and this url will allow the user to view an email thread]
[NEW!] /admin/companies/[id]/emails/[threadId]/[messageId]/reply [Admin] [This is the threadId and messageId passed in from Gmail API and this url will allow the user to reply-all to the selected messageId]
[NEW!] /admin/companies/[id]/emails/new [Admin] [This is where the admin will go to manually compose and send an email to a specific contact at a specific company]
[NEW!] /admin/companies/[id]/documents [Admin] [show all documents that we have that are associated with this company. they should be filterable by status [active/expired] and include ENUM type such as CONTRACT, CHANGE_ORDER, INVOICE, LIEN_WAIVER, etc.]
[NEW!] /admin/companies/[id]/documents/upload [Admin] [This is the page where the admin will go to manually upload documents to the system and associate them with the selected company -- this should allow for dropzone and file browser of MULTIPLE documents -- and it should be capable of processing the documents to pull out all internal metadata, extract searchable text (or OCR with visionai), upload to R2, store in d1 with r2 keys, run embeddings and vectorize, and before uploading -- it should list the documents added to the dropzone and allow the user to specify document type ENUM, a title for the document, description, and or tags]
[NEW!] /admin/companies/[id]/permits [Admin] [show all permits that we have that are associated with this company which are coming from SF Soda API as part of the /permits system -- so here we are just viewing them for the company .. clicking on a permit link will open the /admin/permits/[id] route]
[NO CHANGE] /admin/contracts [Admin] [List of contracts that we have entered in the system that are either in draft, in motion, signed, or cancelled]
[NO CHANGE] /admin/contracts/[id] [Admin] [view the details of the contract... this will be where the user will go to download the contract, review the details, etc.]

Showroom / sourcing ([ADMIN (with exception)])
[DELETE] /admin/showroom — hub [should update the base here to /admin/shopping]
[BROKEN] /admin/showroom/compare [Broken? not updated to]
[BROKEN] /admin/showroom/gaps [Broken?]
[BROKEN] /admin/showroom/intake [Broken?] [I think this is because we switched to a modal but i actually prefer a dedicated page linked from new showroom button on showrooms/ list page]
[BROKEN] /admin/showroom/products [Broken?] [This should be moved to /admin/shopping/showrooms[id]/products -- when the user clicks on the Products bento box preview, it should route to a page listing out the products associated with that showroom and from this page the user can associated brands and products]
[NEW!] /admin/showroom/brands [This should be moved to /admin/shopping/showrooms[id]/brands -- when the user clicks on the Brands bento box preview, it should route to a page listing out the brands associated with that showroom and from this page the user can associated brands and products]
[DELETE!] /admin/showrooms/[id]/brands/[brandId] [DELETE] [when visiting /admin/showrooms/[id]/brands the user will see a list of brands in that showroom -- if the user clicks on a brand they should be routed to /admin/shopping/brands/[id]]
[BROKEN] /admin/showroom/progress [Broken?] [not sure what this is doing]
[BROKEN] /admin/showroom/research [Broken?] [should  move to /admin/shopping/showrooms[id]/research] [we should have the ability to kick off a deep research prompt about a showroom and then view the results]
[BROKEN] /admin/showroom/scan [Broken?] [not sure what this does but I think this is supposed to scan a business card in order to autofill poc info like name etc -- similar to how we use workers-ai on showroom intake]
[BROKEN] /admin/showroom/schedule [Broken?] [I think this is where we used to show the hours but now w show that up on the hero ] [I think the hours on a showroom hero should be a hyperlink to open the full hours table from our d1 hours table as a table M-Sunday]
[BROKEN] /admin/showroom/sourcing [Broken?] [What did this mean?]
[BROKEN] /admin/showroom/showrooms [we fixed this with /admin/shopping/showrooms]
[BROKEN] /admin/showroom/showrooms/[tab] — a dynamic route (the [tab] is a URL parameter, e.g. /admin/showroom/showrooms/directory) [I think this may be duplicative because we no longer have tabs]
[NEW!] /admin/shopping/showroom/[id]/shopping-journal [ADMIN] [should be notes that the user entered about the showroom specifically and then about any brands or products associated with the showroom]
[NEW!] /admin/shopping/showroom/[id]/shopping-journal/new [should be a page dedicated to recording a note against a showroom entity using a title input and plateJs]
[NEW!] /admin/shopping/showroom/[id]/shopping-journal/[id] [should be the view to view [and if button clicked to edit], edit an existing note that was entered against a showroom entity ]
[UPDATE] /admin/showroom/material/[id] · [Ithis should move to /admin/shopping/showrooms/]

---
** I think thse may be duplicative of /admin/showrooms/[id]? **
[DELETE] /store/[id] · [should be moved up to /admin/shopping/stores/[id]]
[DELETE] /store/[id]/[section]   [should be moved up to /admin/shopping/stores/[id]/[section]]
---


[UPDATE] /admin/brands/ · [i think perhaps here [should be moved up to /admin/shopping/brands]
/admin/brands/[brandId] · [should be moved up to /admin/shopping/brands/[brandId]] [This should be like any ecommerce brand website -- focused on the brand and showing all of the products from the brand that we have associated meaning products that we are interested in ... this page should also show the showrooms carrying the brand]
[NEW!] /admin/brands/[brandId]/new [this page should allow the user to input fields that will intake a brand into the system -- and while adding the brand, the user can optionally fill in the stepper page asking about associated products but this can be done later too, and then another stepper asking for showroom associations whereby the user could choose from a multiselect auto complete but this is optional too]
[NEW!] /admin/brands/[brandId]/edit [this page should allow the user to edit fields associated with a brand including any brand details]
[NEW!] /admin/brands/[brandId]/products [this page should allow the user to view all of the products associated with the brand as a list view -- and clicking on any product should take the user to /admin/shopping/products/[id]]
[NEW!] /admin/brands/[brandId]/products/new [this page should allow the user to intake a product and associate it with the brand -- ]
[NEW!] /admin/brands/[brandId]/products/[id] [this page should allow the user to view all of the product details associated with a product -- ]
[NEW!] /admin/brands/[brandId]/products/[id]/edit [this page should allow the user to edit product details for a specific product associated with a brand]  
[NEW!] /admin/brands/[brandId]/research [this page should allow the user to initiate a deep research prompt about the brand and view the deep research findings as well at this link]

[NEW!] /admin/brands/[brandId]/shopping-journal [should be notes that the user entered about the brand specifically and then about any products associated with the brand]
[NEW!] /admin/brands/[brandId]/shopping-journal/new [should be a page dedicated to recording a note against a brand entity using a title input and plateJs -- upon save, the new shopping_journal_id should be saved perhaps onto the product d1 table or into a shopping_journal mapping table that is tracking journal entries for showroom, product, brand, contractor]
[NEW!] /admin/brands/[brandId]/shopping-journal/[id] [should be the view to view [and if button clicked to edit], edit an existing note that was entered against a brand entity ]
[UPDATE] /admin/brands/types [should be moved up to /admin/config/brands/types]

[UPDATE] /admin/products/ · [should be moved up to /admin/shopping/products]
[UPDATE] /product/[id] · [should be moved up to /admin/shopping/products/[id]] [ i think this may be duplicative of below]
[UPDATE] /admin/products/[id] · [should be moved up to /admin/shopping/products/[id]] [should look like an ecommerce product details page with pictures, pricing, showrooms that are associated with this product, {deep research for this product specifically -->} online rating, online number of reviews, online review summary from ai, user rating, user rating rationale]
[NEW!] /admin/products/[id]/shopping-journal/new [should be a page dedicated to recording a note against a product entity using a title input and plateJs -- upon save, the new shopping_journal_id should be saved perhaps onto the product d1 table or into a shopping_journal mapping table that is tracking journal entries for showroom, product, brand, contractor]
[NEW!] /admin/products/[id]/shopping-journal/[id] [should be the view to view [and if button clicked to edit], edit an existing note that was entered against a product entity ]



[NEW] /admin/shopping/journal [ADMIN] [This should be a notes viewer that is actually setup with filters and keyword searching that is rag based] [this view should be sourcing journal notes of all kinds -- showroom visits, product notes, brand notes, contractor notes, etc]
]





Admin / ops
[NO CHANGE] /admin [ADMIN]  [landing page should continnue being admin analytics dashboard]

[NO CHANGE] /admin/config · [ADMIN] 


[NO CHANGE] /admin/integrations/usage [ADMIN] 

[NO CHANGE] /admin/dialer [ADMIN] [this is a working feature that will prepopulate with contacts i need to call about a given topic -- like i need to call about 1- sink vendors next week to get pricing, so this used to display all the people i front loaded from gemini deep research where i ask gemini to find me top 10 concats for given topic, those people get loaded to my dialer sheet where i call each one and take notes based on the phone conversation ]

[NO CHANGE] /admin/permits · [ADMIN] [View all permits for the property ]
[NO CHANGE] /admin/permits/[id] · [ADMIN] 
[NO CHANGE] /admin/permits/[id]/contacts · [ADMIN] 
[NO CHANGE] /admin/permits/[id] [ADMIN] 

[UPDATE] /admin/research · [ADMIN] [move to admin/planning/research]
[UPDATE] /admin/research/[id] · [ADMIN] [move to admin/planning/research/[id]]

[DELETE]/admin/supporting-docs
