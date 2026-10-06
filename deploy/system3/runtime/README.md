# System3 desktop runtime closure

English | [中文](README.zh.md)

This private dependency manifest supplies the built rc.2 Harness CLI, Web assets, native profile dependencies and System3/Jev plugins to the separate xDAN-System3-Frontend application. It exposes no application entry or executable; the desktop application launches the deployed `dsh` profile.

Build the Harness artifacts before deploying this package. The Frontend preparation script owns assembly, runtime identity checks and platform packaging. Development may resolve an explicitly selected Harness workspace; packaged applications require a complete deployed dependency tree and must not fall back to an installed stock DSH package. Credentials remain outside this package and its artifacts.
