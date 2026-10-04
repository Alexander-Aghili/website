---
layout: page
title: AtlasProjects
description: "Interactive maps of abandoned airfields and aviation crashes, with search, filters, and source references."
date: 2026-10-02
importance: 0
category: GIS
img: assets/img/AtlasProjects/atlas-main.png
---

{% include figure.liquid path="assets/img/AtlasProjects/atlas-main.png" alt="Satellite view of the continental United States." class="img-fluid rounded z-depth-1" loading="eager" %}

AtlasProjects brings together two interactive maps for exploring aviation history. Each map includes search, filters, and links to its sources.

### Abandoned Airfield Atlas

{% include figure.liquid path="assets/img/AtlasProjects/abandoned-airfields.png" alt="Abandoned Airfield Atlas with its searchable airfield catalog and clustered locations across the United States." class="img-fluid rounded z-depth-1" zoomable=true %}

Explore abandoned and little-known airfields from Paul Freeman’s catalog. Search locations, filter the catalog, and switch between street and satellite maps. Entries link to the original descriptions and distinguish approximate or missing coordinates.

[Open the airfield map]({{ '/abandoned-airfield-atlas/' | relative_url }}) · [Source code](https://github.com/Alexander-Aghili/AbandondedAirfieldAtlas)

### Aviation Crash Atlas

{% include figure.liquid path="assets/img/AtlasProjects/air-crashes.png" alt="Aviation Crash Atlas showing the worldwide crash map, aircraft markers, and search and date filters." class="img-fluid rounded z-depth-1" zoomable=true %}

Explore aviation crash records by date, aircraft, and location. Records with sourced crash-site coordinates appear on the map; other records remain searchable. Entries include Wikipedia links, available images, and location-quality notes.

[Open the crash map]({{ '/air-crash-atlas/' | relative_url }}) · [Source code](https://github.com/Alexander-Aghili/Air-Crash-Atlas)
