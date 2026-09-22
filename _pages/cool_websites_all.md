---
layout: page
title: Cool Website Wednesday
permalink: /cool-website-wednesday/all/
description: Every issue so far, in one list.
nav: false
---

<style>
  .cw-all-back { display: inline-block; margin-bottom: 1.25rem; }
  .cw-all { list-style: none; margin: 0; padding: 0; }
  .cw-all li {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    padding: 0.6rem 0;
    border-bottom: 1px solid var(--global-divider-color);
  }
  .cw-all li:last-child { border-bottom: none; }
  .cw-all .cw-issue {
    flex-shrink: 0;
    min-width: 2.5rem;
    color: var(--global-theme-color);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .cw-all .cw-all-name { font-weight: 600; white-space: nowrap; }
  .cw-all .cw-all-desc { color: var(--global-text-color-light); }
  @media (max-width: 576px) {
    .cw-all li { flex-wrap: wrap; }
    .cw-all .cw-all-desc { flex-basis: 100%; padding-left: 3.25rem; }
  }
</style>

<a class="cw-all-back" href="{{ '/cool-website-wednesday/' | relative_url }}">&larr; Back to Cool Website Wednesday</a>

{% assign issues = site.cool_websites | where_exp: "item", "item.pinned != true" | sort: "date" | reverse %}
{% assign issue_count = issues | size %}

<ul class="cw-all">
  {% for site_entry in issues %}
  {% assign issue = issue_count | minus: forloop.index0 %}
  <li>
    <span class="cw-issue">#{{ issue }}</span>
    <a class="cw-all-name" href="{{ site_entry.url | relative_url }}">{{ site_entry.title }}</a>
    {% if site_entry.description %}<span class="cw-all-desc">{{ site_entry.description }}</span>{% endif %}
  </li>
  {% endfor %}
</ul>

{% if issues == empty %}
  <p>No cool websites yet, check back soon!</p>
{% endif %}
