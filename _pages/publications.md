---
layout: page
permalink: /publications/
title: publications
nav: true 
nav_order: 2

scholar:
  sort_by: year
  order: descending
---
<div class="publications">
  {% bibliography -f papers -q @article %}
</div>

