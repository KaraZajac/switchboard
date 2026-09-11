# The signing key

`switchboard-shared.jks` signs every build of the Android client — debug,
release, and whatever CI produces.

**It is public on purpose, and its password is `switchboard`.**

## Why a key is in a repository at all

Android will only install an APK over another when both were signed by the same
key. Before this, every build used whatever throwaway debug key the machine
happened to have, so no release could upgrade another: installing a new version
meant uninstalling the old one and losing everything in it — the paired device,
the vault, the history.

## What it costs

Anybody can sign an APK with this key, and Android will accept it as an upgrade
to a Switchboard installed from a release here. Sideloading is already only as
trustworthy as the place the file came from, so for a client distributed through
GitHub releases this is the right trade.

It stops being the right trade the day this ships through a store, or the day
anybody is expected to install it without knowing where it came from. At that
point the key moves into CI secrets as a private one, the version code carries
on where it left off, and everybody already running a build signed with this key
has to reinstall once.

## Replacing it

    keytool -genkeypair -v \
      -keystore keystore/switchboard-shared.jks \
      -storetype PKCS12 -alias switchboard \
      -keyalg RSA -keysize 4096 -validity 36500 \
      -storepass <password> -keypass <password> \
      -dname "CN=Switchboard, OU=Shared signing key, O=Switchboard, C=US"

Changing the key breaks upgrades for everyone on the old one, which is the
whole reason this file exists. Do it once, deliberately, and say so in the
release notes.
