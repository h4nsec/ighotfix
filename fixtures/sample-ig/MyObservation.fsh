// A small sample profile for development.
Profile: MyObservation
Parent: Observation
Id: my-observation
Title: "My Observation Profile"
Description: "Used to exercise the FSH adapter."

// Core constraints
* status 1..1 MS
* code 1..1
* code from MyObservationCodes (preferred)
* category 0..* MS
* subject MS
* category ^slicing.discriminator[0].type = #value
* category ^slicing.discriminator[0].path = "code"
* category ^slicing.rules = #open
* category contains vitalsign 0..1

* extension contains http://example.org/StructureDefinition/obs-bodysite named bodySite 0..1