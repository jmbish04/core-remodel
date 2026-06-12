there is no way that you built in the frontend pages and also hooked them up too

Everything shoul be logged in d1 ... create store (id auto pk, name, description, price point [$,$$,$$$], website url, address, phone,  store_email, poc_name, poc_email,  records .. store_product table (id auto pk, store_id fk, timestamp, item name, description, colors, preferred color, sku, price, json_details, notes, lead_time, possible_discounts, trade_discount


store_bayarea_cities -- mapping to bay area cities

* id auto pk
* bay_area_city_name
* distance_from_san_francisco

store_bayarea_city_mapping -- mapping all locations of a store to bay area city -- some showrooms have multiple locations 

* id auto pk
* store_id fk 
* bay_area_city_id fk 
* weekday_hours
* weekend_hours
* isOpenSaturdays
* isOpenSundays
* phone
* address
* website
* zip code
* google_maps_link
* distance_from_sf_time
* distance_from_sf_miles
* notes -- why this location may standout -- perhaps the wider variety on display, better reviews/ratings, special item on display, etc

store_product_docs 1:M --- images that are stored on cloudflare images 
id auto pk
store_product_id fk 
type (image, pdf)
url (r2 url if pdf or other document, cloudflare image url if image hosted on cloudflare images)

store_product_research 1:M -- ratings and reviews on store products 
id auto pk
store_product_id fk
timestamp
finding
finding_url
sentiment [good, bad, neither good or bad, etc]


store_research 1:M -- ratings and reviews on store products 
id auto pk
store_id fk
timestamp
finding
finding_url
sentiment [good, bad, neither good or bad, etc]

store_product_area_def -- definitions of product areas like bathroom, kitchen, etc 

* id auto pk
* room_name [kitchen, bathroom, outdoor, etc]
* name [room_name above is kitchen, product area name is faucet -- for example]
* description
* isActive

store_pa_mapping -- 1:M

* id auto pk
* store_id fk
* product_area_id fk

store_product_pa_mapping -- 1:M

* id auto pk
* store_product_id fk
* product_area_id fk


store_notes

* id auto pk
* store_id fk
* timestamp
* note
* isActive

store_product_note

* id auto pk
* store_product_id fk
* timestamp
* note
* isActive


store_similar_map -- tracking similar stores

* id auto pk
* parent_store_id fk  -- the similars are genearted from this starter
* similar_store_id fk -- the simiar model found compared to parent model
* similar_store_price_point [$,$$,$$$,$$$$, etc]
* ai_analysis -- how similiar are the stores and would this simiar item offer any advantages .. any of those being significant advantages?
* ai_similarity_review_score -- should user even look at this similar store
* ai_similiarty_review_score_rationale
* user_feedback_notes
* isLikedByUser
* user_rating_on_similiarity [1-5]
* isUserInterested -- will user be exploring this similar store 
* user_interest_notes 
* timestamp

store_product_similar_model_map -- tracking similar models

* id auto pk
* parent_store_product_id fk  -- the similars are genearted from this starter
* similar_store_product_id fk -- the simiar model found compared to parent model
* similar_model_price
* similar_model_price_diff
* ai_analysis -- how similiar are the models and would this simiar item offer any advantages .. any of those being significant advantages?
* ai_similarity_review_score -- should user even look at this similar item
* ai_similiarty_review_score_rationale
* user_feedback_notes
* isLikedByUser
* user_rating_on_similiarity [1-5]
* isUserInterested -- will user be exploring this similar item 
* user_interest_notes 
* timestamp
* 

showroom_tag_def -- definitions of tags

* id auto pk
* name
* description
* color
* parentId [fk to showroom_tag_def parent row id] 
* isActive
* isStoreTagOnly
* isStoreProductTagOnly

store_tag_mapping -- 1:M

* id auto pk
* timestamp
* showroom_tag_id fk
* store_id fk 

store_product_tag_mapping -- 1:M

* id auto pk
* timestamp
* showroom_tag_id fk
* store_product_id fk 


store_rating

* id auto pk
* store_id fk
* rating [1-5]
* rating_notes
* isActive
* replacedById [fk to store_rating revision replacement row id]

store_product_rating

* id auto pk
* store_product_id fk
* rating [1-5]
* rating_notes
* isActive
* replacedById [fk to store_product_rating revision replacement row id]



The research should kick off the minute that a store or store product is added into the system 

There should be a dedicated tool on this app that would allow for scanning barcodes on mobile phone so that ai vision could be asked to decode to further help it to perform research, price matching, very very very similar items, product reviews, etc -- which would be a photo of the barcode that would be decoded as part of a workflow that would then try to fill in research, tags, description, reviews, ratings, warranties, quality, etc, pricing, similar items
