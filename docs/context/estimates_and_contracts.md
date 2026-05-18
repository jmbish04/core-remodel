what you have now is looking really good ... i need you to please kindly expand upon this .... as a home owner im going to get as many bids and esitmates as i can ... i need you to also include into this tracker the ability to track the estimates that we receive by having an entry system to collect all of the various estimates we will receive from contractors, sub contractors, materials vendors, etc ... we need to track in d1 the name of the business/contractor we have received an estimate from, the type of business (contractor, subcontractor, materials vendor, etc), website, email, phone number, address, [if contractor or subcontractor, the clsb_license number], etc --- ideally the user can intake these estimates in 2 main ways: by uploading the pdf of the document they received with the estimation and then have workers ai to extract as much of that as possible using a structured response by passing worker ai a json schema amd using the structured response method and then showing that extracted information in the intake form with the input fields pre-filled so the user can edit if need be.. .. the 2nd way is to enter the details by hand if there was no pdf and it was the user researching material quotes or talking with a contractor or sub contractor verbally ... so perhaps the system should allow for a viewport of estimates received where the user can view all estimates received to date, click on one and view the details, update the details (creating a revision), etc ... but also having a button there to record a new estimate which would then open a full page intake screen that creates a draft record in the d1 table so that changes are saved automatically --- dont want the user to lose their data if it takes a bit to track down all the details -- so the estimateions viewport should list all received estimations, draft intake records that are still pending final submittal, listing estimations that were recently updated, etc.

so back to that intake new estimation full page with auto saving drafts -- the user should walk through a stepper so that the intake is paginated like a wizard .. the sidebar of this page would have back button to take them back to the estimatins view port and under that back button a vertical sidebar of all the steps involved in entering the estimation ..

1.  Source of estimation:
    - I have an estimation record [upload button] {pdf, picture taken from phone like of the materials price details in the showroom, etc}
    - I have a URL (enter url) {the website of a materials supplier product listing containing the details of the material and the price etc}
    - word of mouth / verbal [text area for the user to enter information, would be great to have workers ai whisper model to offer the user speech to text]

The user must choose one of these options - if they have a document this must be processed to extract the text then run through workers ai structured response to extract the information into a strict json schema that we can easily and reliably save against the estimation draft record in d1 and also pre-fill the intake fields on the next page #2

- same for URL but we would use cloudflare browser render to go and scrape this content for us using browser render binding

- For word of mouth, still just like above ...send this content to workers ai for structured response json schema to be filled in so we can process it

\*\* We should have a mapping table for what the user provides here so that if there is a revision in the future which will largely be running this process again, we are tracking the various sources of data we had received along the way from this company/contractor

-- which means we should also have a mapping table for the processed metadata from workers ai structured response and for each thing the worker ai model extracted we also store next to those rows in d1 what the user ultimately confirmed in step #2

tables: - estimate: (id auto pk, timestamp created, timestamp last modified, estimate_status_id (negotiating, acccepted, etc), estimate_company_id (fk)

    - estimate_status (id auto pk, name, description) -- this needs to have an api service so the dropdown on the frontend allows the user to update based on defined status and shows the user the description and name

    - estimate_revisions (id auto pk, estimate_id (fk), revision_number, timestamp created, is_draft (this helps us with the auto draft save), estimate_status_id, status_notes)
    -- api needs to be able to list all revisions so it can be seen on the frontend with all details about each revision including the tables below too .. all tables in the relational estimates_* family -- and the api needs to be able to identify which revision is the latest revision so that the latest revision and all of its data from the other tables like document and extracted text etc etc can be shown as the main information on the screen -- the frontend needs to show the latest revision details on the screen as the main record with its revision number visible and the frontend needs to show a button to see all revisions which opens a modal and allows the user to traverse through all revisions to date

    - estimate_document: id auto pk, estimate_revision_id (fk), type [photo, pdf, url, free text, etc], r2_url [where the content was uploaded to a bucket -- the estimate pdf or scraped website pdf], extracted_text [extracted text from estimate photo or pdf, browser render markdown extracted from website, free text user entered in in liue of a document ], ai_structured_extraction [JSON workers ai extracted from the extracted_text]

    - estimate_prop_keys_types:
        - id auto pk
        - property (key from workerai structured response) -- unique only, what we expect -- so everytime worker ai structured response is processed the system needs to add any property from that structured response not found in this table
        - data_type (the script that detects the property is not in this table can/should be able to pull its expected data type from the schema def given to workersai for the structured response extraction)


    - estimate_prop_keys: -- this will include anything found in that extracted content as well as confirmed in step #2 below
        - id auto pk
        - estimate_revision_id [fk]
        - estimate_document_id [fk]
        - property (key from worker ai structured response)
        - estimate_prop_keys_types_id [so that we know what type of data this is so the api is able to send that in the payload so the frontend is showing it correctly and so that any agentic operations that receive this data also know what type of data it is]
        - workerai_extracted_value (what worker ai extracted)
        - intake_form_value (what was auto filled on intake form on page 2 from workers ai response initially but then the user may have changed on submit -- we want to see in the d1 table if this happens)

- estimate_company: id auto pk, name, phone, email, website, cslb_license_number

- estimate_company_contacts: id auto pk, name, phone, email, title, estimate_company_id (fk) \*_ this way we can keep track of who said what and keep it logged as well in our system since all emails will be sent to the worker now it can tie that email to who is sending it .. this table will not be filled out on initial estimate with all employee contacts we will interact with ... so when an email is received by the worker ai model it should determine whether or not there is a record to match already and if not, is the email domain (`@acme.com`) seen somewhere in the table already and if yes, then at least the workers ai can enter the estimate_company_id as fk with the person's name and email address -- otherwise, the worker ai model would just enter name and email into this table and the ux will need to show contacts the user needs to map to a company and/or create a company so the contact can be mapped to that company)_

2. Confirm esimate details [ prefilled by processing the workers ai structured response of what it gleaned from the input on page 1 (PDF, URL, free text) .. with the schema that worker ai was given to follow matching the schema below since we know thats what we need to collect
   - type of estimate / type of business it was received from [contractor, subcontractor, materials company, skill labor like cabinets, etc]
   - estimate_status_id (fk) -- defaults to something like `Reviewing / Not yet accepted`
   - [the user won't be asked this but for your reminder, dont forget to log estimate_revision_id when you update the estimate_prop_keys_table]
   - estimate_revisions.status_notes -- user can enter notes at this stage which will be saved on the estimate_revisions table [thats why i reminded you not to forget about making the fk estimate_revision_id]
   - [this will be a dropdown pointing to the estimate_company table .. workers ai structured response should identify the company if the company is already known, because it will be provided all companies in the prompt where its asked to extract the details from the photo/pdf/url/free text into structured response .. and if workerai cant match up to an existing company, the worker ai should be providing a structured response object for company name, etc all the fields needed to create an estimate_company record and that should be shown as a new company sub intake form under the company dropdown [company dropdown showing new company with input fields under for the following pre-filled based on what workers ai could extract so the user can confirm the details and then upon submitting this intake it will create the company record in the estimate_companies table]:
     - estimate_company.name: company / contractor / sub contractor / skilled laborer name
     - estimate_company.type: company / contractor / sub contractor / skilled laborer / etc
     - estimate_company.cslb_license_number [req'd if contractor or sub contractor, CSLB license number]
     - estimate_company.website,
     - estimate_company.email,
     - estimate_company.phone number
   - date of estimate
   - warranty details listed
   - cancellation details listed
   - deposit amount listed [if any]
   - etc ...
   - total amount of estimate
   - total tax
     ---- [line items from estimate]

3. Review, Confirm, Submit

- show the data entry record to the user for confirmation and then offer a save draft button, go back button, and a submit button

---

Please think about this model above and also try to replicate this for recording the contracts received from these companies -- some may not have a contract per say like a materials company or skills laborer .. but a contractor / sub contractor absolutely must have a contract to provide us and we will need a rigorous review process with workers ai extracting text, analyziing it, etc .. at first to advise us about negotiating better terms, filling in missing details, adding language to protect us, fixing timeline, etc ... but then once accepted, the contract needs to be extracted to d1 tables / fields to keep the timeline details, warranty information, payment schedule [what must be accomplished to qualify a progress payment, how much is due for the progress payment, etc] so that the agent who is monitoring emails etc is able to help keep watch and stay rooted against this contract to help us ensure that everything is happening the way it is supposed to and that a contractor and homeowner (me) are communicating well and in advance and that the contractor is not being a bad faith actor trying to screw the homeowner.
