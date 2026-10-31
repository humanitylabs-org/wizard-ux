# Paper Shaders (vendored subset)

Source: `@paper-design/shaders` 0.0.82 (https://github.com/paper-design/shaders), Apache-2.0 — see `LICENSE` and
`NOTICE` beside this file. Found through Teknium's Uncommon Web library (webdev.teknium.io, "Paper Shaders · Vanilla
ShaderMount uniforms").

Only the framework-free core the Orb layout's "Nebula" entity needs, copied unmodified from `dist/` (source-map
comments removed): `ShaderMount` (+ vertex shader, sizing, utils, colour parsing, noise texture) and the
`metaballs` fragment shader. Nothing else from the package is shipped.
