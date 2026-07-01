---
title: Fields of the World 
website_url: http://fieldsofthe.world/ftw-inference-app/#map
date: 2026-07-01
description: A machine-learning map of the world's agricultural field boundaries, letting you explore the planet's farmland from above.
---

This is a pretty cool website which lets you explore all of the world's agricultural fields. 
The Fields of the World project aims to create a global map of the entire world's
agricultural field boundaries using machine learning techniques. The project was led by researchers at Arizona State, Microsoft AI, Washington University in St. Louis, and the Taylor Institute, who published a paper titled: *Fields of The World: A Machine Learning Benchmark Dataset For Global
Agricultural Field Boundary Segmentation* in 2024 on arxiv, available [here](https://arxiv.org/pdf/2409.16252). Both the code and the dataset is available from the paper. 

There are a couple of interesting components that stand out to me. As a California native, the first
major thing that stands out is the central valley, an agricultural powerhouse in the United States
which produces a quarter of the U.S. food supply and 40% of the fruits, nuts, and table food. Of
course, this is controversial since plants like Almonds consume enormous amounts of water relative
to their caloric output in a often drought ridden state. As I have driven past these fields many
times, it is fascinating to see all of the fields organized from above. I imagine all of the food in each plot, stretching beyond the horizon, with workers picking berries and machines scraping fields to be put in grocery stores and sold in markets. It is quite the sight to see.

{% include figure.liquid loading="eager" path="assets/img/cool_websites/fields_of_the_world/California.png" class="img-fluid rounded z-depth-1" zoomable=true %}

Overall, the model seems to do a pretty good job:

{% include figure.liquid loading="eager" path="assets/img/cool_websites/fields_of_the_world/GoodLookingFields.png" class="img-fluid rounded z-depth-1" zoomable=true %}

Though at the margins there are certainly errors:

{% include figure.liquid loading="eager" path="assets/img/cool_websites/fields_of_the_world/Errors.png" class="img-fluid rounded z-depth-1" zoomable=true %}

The other interesting thing you can get from this are the locations of the world's major bread-baskets, with the American midwest and Canadian Prairies:

{% include figure.liquid loading="eager" path="assets/img/cool_websites/fields_of_the_world/NorthAmerica.png" class="img-fluid rounded z-depth-1" zoomable=true %}

The Eurasian Steppe in the Ukraine region:

{% include figure.liquid loading="eager" path="assets/img/cool_websites/fields_of_the_world/Europe.png" class="img-fluid rounded z-depth-1" zoomable=true %}

And in the Indo-Gangetic and North Chinese plains:

{% include figure.liquid loading="eager" path="assets/img/cool_websites/fields_of_the_world/IndiaChina.png" class="img-fluid rounded z-depth-1" zoomable=true %}

Go out and explore where all the world's food is grown! Each of these fields is managed by a person,
family, or corporation growing the food to feed the 8+ Billion people on Earth. It is certainly
quite a feat to be able to view, and investigate, the agricultural fields around the globe. 
