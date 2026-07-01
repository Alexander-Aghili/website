---
layout: page
title: Cool Website Wednesday
permalink: /cool-website-wednesday/
description: A cool website I stumbled onto, shared every Wednesday. Could be anything I find interesting, whether a tool, a toy, an experiment, or a corner of the web worth a click.
nav: true
nav_order: 4
---

<style>
  .cool-websites .post-list { list-style: none; margin: 0; padding: 0; }
  .cw-card {
    position: relative;
    padding: 1.25rem 1.5rem;
    margin-bottom: 1.25rem;
    border: 1px solid var(--global-divider-color);
    border-radius: 8px;
    transition: box-shadow 0.2s ease, transform 0.2s ease;
  }
  .cw-card:hover { box-shadow: 0 4px 14px rgba(0, 0, 0, 0.1); transform: translateY(-2px); }
  .cw-card-link { position: absolute; inset: 0; z-index: 1; border-radius: 8px; }
  .cw-card-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .cw-card .post-title { margin: 0; }
  .cw-visit {
    position: relative;
    z-index: 2;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.8rem;
    font-size: 0.85rem;
    white-space: nowrap;
    border: 1px solid var(--global-theme-color);
    border-radius: 6px;
    color: var(--global-theme-color);
  }
  .cw-visit:hover { background: var(--global-theme-color); color: var(--global-bg-color); }
  .cw-card .cw-desc { margin: 0.6rem 0 0.4rem; }
  .cw-card .post-meta { margin: 0; }
</style>

<div class="cool-websites">
{% assign pinned = site.cool_websites | where: "pinned", true | sort: "date" | reverse %}
{% assign unpinned = site.cool_websites | where_exp: "item", "item.pinned != true" | sort: "date" | reverse %}
{% assign websites = pinned | concat: unpinned %}

  <ul class="post-list">
    {% for site_entry in websites %}
    <li class="cw-card">
      <a class="cw-card-link" href="{{ site_entry.url | relative_url }}" aria-label="Read post: {{ site_entry.title }}"></a>
      <div class="cw-card-head">
        <h3 class="post-title">{{ site_entry.title }}</h3>
        {% if site_entry.website_url %}
        <a class="cw-visit" href="{{ site_entry.website_url }}" target="_blank" rel="noopener noreferrer">
          Visit site
          <svg width="1rem" height="1rem" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
            <path d="M17 13.5v6H5v-12h6m3-3h6v6m0-6-9 9" class="icon_svg-stroke" stroke="currentColor" stroke-width="2" fill="none" fill-rule="evenodd" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        </a>
        {% endif %}
      </div>
      {% if site_entry.description %}<p class="cw-desc">{{ site_entry.description }}</p>{% endif %}
      <p class="post-meta">
        <i class="fa-solid fa-calendar fa-sm"></i> {{ site_entry.date | date: '%B %d, %Y' }}
        {% if site_entry.website_url %}
        &nbsp; &middot; &nbsp;
        {{ site_entry.website_url | remove: 'https://' | remove: 'http://' | split: '/' | first }}
        {% endif %}
      </p>
    </li>
    {% endfor %}
  </ul>

{% if websites == empty %}
  <p>No cool websites yet, check back on Wednesday!</p>
{% endif %}
</div>
