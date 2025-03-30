---
layout: post
date: 2025-03-27
title: 'Writing a Pager for the Twizzler Research Operating System'
categories: Software OS Paging 
thumbnail: assets/img/TwizzlerPager/thumbnail.png
giscus_comments: true
---

### Introduction
Last year, I was a hired as an undergradute researcher on a DARPA project to develop a research operating system called [Twizzler](https://github.com/twizzler-operating-system/twizzler) [[1](https://legacy.www.sbir.gov/node/2347441)]. Very briefly, the Twizzler Operating System (Twizzler OS) is a research operating system that places data at the center, allowing programs to directly access and share memory-resident objects (locally and across machines) with minimal overhead and without the complexity of serialization. To learn more about the operating system itself, you can visit the [about page](https://twizzler.io/about/) or read the [original paper](https://www.usenix.org/system/files/atc20-bittman.pdf). In this blog, I will describe what a pager is, what the spec was for our pager, how I implemented the paging system for Twizzler, and some of the lessons I learned through this process at the end.

### Pager
First, I will establish how a paging system works in a kernel like Linux. 

### RFC
The full RFC for the Paging system can be found [here](https://github.com/twizzler-operating-system/rfcs/blob/dbittman-pmgr/text/0000-pmgr.md). 

### Implementation

### Lessons

