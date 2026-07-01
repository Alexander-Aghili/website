---
layout: page
title: "Computational Methods for Fluid Dynamics Simulations"
description: "A seminar final project surveying the numerical solution of the Navier-Stokes equations, covering finite difference and finite volume spatial discretizations paired with explicit Runge-Kutta time integrators."
date: 2026-06-30
importance: 0
category: Computer Science and Mathematics Projects
img: assets/img/lava_cfd.jpeg
external_links:
  - label: "Main Report"
    url: assets/pdf/Seminar_Final_Project.pdf
  - label: "Slideshow"
    url: https://docs.google.com/presentation/d/e/2PACX-1vQG2b1Oc3wv336p7rnketeOPzGUi0SP0TiItWdinVze3045wPXW0bxht8Z7sCkYqCjgUDWqCh9souhq/pub?start=true&loop=true&delayms=30000
---

This seminar final project reviews the two principal families of spatial discretization used in computational fluid dynamics and the explicit time integrators that complete the method-of-lines paradigm for the compressible Navier-Stokes equations. It begins from the continuum setting and the conservation (divergence) form of the governing equations, then works through the discretizations and stability theory that make their numerical solution possible.

Finite difference methods are derived from Taylor expansion on structured grids, and higher-order central stencils are constructed by Richardson extrapolation on the same central formula. Finite volume methods are built instead on the integral conservation laws over control volumes, with Riemann-solver-based numerical fluxes such as Roe, HLL, and Godunov that make the schemes robust to shocks and contact discontinuities. The paper summarizes the trade-offs between the two families in geometry flexibility, exactness of local conservation, and the cost of high-order accuracy.

For time discretization, the method of lines reduces the spatial problem to a system of ordinary differential equations, which is then advanced by an explicit integrator. The paper contrasts classical fourth-order Runge-Kutta for smooth, convection-dominated flow against strong stability preserving SSP-RK3, which retains the nonlinear stability bounds of forward Euler under flux limiting. It closes with the CFL condition, the linear stability regions of each integrator, and the implicit-explicit splittings used at high Reynolds number on fine grids.

The slideshow below presents the project.

<div style="position: relative; width: 100%; padding-bottom: 77.01%; height: 0; overflow: hidden;">
  <iframe src="https://docs.google.com/presentation/d/e/2PACX-1vQG2b1Oc3wv336p7rnketeOPzGUi0SP0TiItWdinVze3045wPXW0bxht8Z7sCkYqCjgUDWqCh9souhq/pubembed?start=true&loop=true&delayms=30000"
          style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"
          frameborder="0" allowfullscreen="true" mozallowfullscreen="true" webkitallowfullscreen="true"></iframe>
</div>

*Cover image courtesy of NASA LAVA.*
