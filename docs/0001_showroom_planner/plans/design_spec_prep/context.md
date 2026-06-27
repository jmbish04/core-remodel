Act as an Expert UX Designer. Build a complete user persona profile and chronological customer journey map for a target user trying to achieve [insert specific goal, e.g., buy a concert ticket in under 2 minutes]. Outline their actions, touchpoints, pain points, and emotional highs and lows across 4 core phases: Discovery, Onboarding, Core Task Execution, and Post-Task Engagement. Include specific UX opportunities for each phase.


I'm building a cloudflare worker that will help organize my home remodel 



I have recently found it difficult to manage the showrooms to visit -- there are so many in the bay area and really there are so many "hubs" of places to seek home remodel show rooms 



Like East Bay, San Francisco Design District, Penninsula, South Bay, Mill Valley, Walnut Creek, etc. 



Then there are going to the best of the best in their categories ... like IRG is known for being the largest, etc. 



So it would be great to have in my app a listing of all the show rooms that are highly rated across the entire bay area ... but also flaging the best of the best in each category -- then helping me map out the show rooms to visit .. so if I go say to Walnut Creek to see one of the best of the best showrooms then while I'm up there I can make the most of my trip by visiting some other show rooms in that cluster 



Also, while I'm at it -- It would probably actually make sense to come up with the materials list that  I need for my remodel ... which is an iterative process ... and then of course having that material list play along and tie into my budget, too. 



I can click into a material item listed to view that material in a material viewport ..a page where I can view and modify the material details like qty, budget, etc --  where there is a hero at the top with the name of the material, an image perhaps scraped from the web or uploaded by me, the quanity needed, the budget range I have made available for, notes, etc ... i can also see on this page some of the show rooms in the bay area that may be interesting to me to source this material from.



Then, being able to start different gemini deep research agents to go out and research bay area show rooms based on my materials list:

 -- TARGETED MATERIALS RESEARCH: The user selects particular items and ask gemini to specifically research them to find out more information like a buying guide, online reviews, if there are any known upcoming sales, seasonal sales, online sites where I can order for savings, etc -- but also to have that research give me flags like keep in mind if you install this material you will need to consider xyz or also add to your material list a,b,c -- for example, if i had a steam shower on my materials list and the research came back talking about how the steam shower requires an enclosure etc etc -- then my cloudflare agents sdk agent interpreting the research findings would add a draft material item into the queue for my approval all the materials we would need to add if steam shower was important to us, etc 



--  ITERATIVE FEEDBACK LOOP: As part of my showrooms app, I will have the ability to leave notes ont he show rooms, add products that I'm interested in from those showrooms, or notes about being interested in a product but feedback about what I didnt like (design, price, etc) 



So as a user, I could initiate a gemini deep research agent to go out and find me more information about what my feedback involves on certain products that I have added notes to -- If it was positive notes I left and I have indicated that I will probably purchase that item ... research can perhaps go out and scour the internet to find the best possible option available in terms of price -- this happened recently for us when I rean a deep research prompt about finding a show room of subzero fridges and the deep research bot flagged a clearance item on an unopened subzero fridge -- which we ended up buying at $5500 instead of $11,000



Additionally, the deep research agent would review any negative feedback on a product or item (notes left by the user in the showroom viewport when journaling about a product seen in the store, etc) -- and the gemini deep research agent would then formulate a plan to go out and do deep research on the user's feedback so that the deep research agent can try and find additional products for the user to consider, different showrooms in the bay area, etc --- as if gemini deep research were a white glove sales agent who showed a customer a product and the customer said "its' nice but you know, I was hoping for something that was a bit more modern and moody" then the sales clerk would go back searching for whatever the material was and try and find something similar to the product at hand / material at hand that was more modern and more moody ... this is a simple example, but I hope it illustrates the point ... this could be for feedback on stone, tiles, hardwood, cabinets, plumbing fixtures, paint colors, tvs, landscaping -- anything. 







Please build a plan for the showroom details we discussed where this showroom feature is a suite of pages that will help with capturing the materials list for a remodel … this should be an organized list of materials that a professional contractor or architect would easily recognize, meaning the materials list is in a common format that the industry uses — but still in shadcn components only. The materials list should be grouped logically and the user should be able to click into a material listed item to view that material in a viewport where the user can modify/view budget details allocated for the material, quantity of the material , and other notes etc.

Then on show rooms, there should be a listed page of all showrooms with a filter at the top based on hub / city, specialty of the showroom, dollar sign, etc. then under the filters there should be a map that shows where all of the showrooms are located (reflective of the active filters) with markers color coded based on show room type - clicking on a marker should show a card of the show room where the card has a photo of the showroom at the top and a description of the showroom as it reflects to our materials list, etc and a link to open the showroom in showroom viewport

Under the map should be the showrooms in tabular format with the showroom name being clickable to open the showroom viewport.

Showroom viewport should show a photo of the showroom , name, phone, address, emails, website, etc

Also on the showroom viewport should be ability to view and create notes, and add materials to the wishlist and also mark items as purchased etc.

And ability to rate showroom, add showroom to favorites list, mark showroom as uninterested and why, and mark showroom as interested but need more information (add notes)

This is the baseline of me describing this feature. Please use brainstorming to build functionality that really helps homeowners manage this complex expensive process. /plan