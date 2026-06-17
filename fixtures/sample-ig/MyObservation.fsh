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
* subject MS
