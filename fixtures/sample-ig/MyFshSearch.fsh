Instance: my-fsh-search
InstanceOf: SearchParameter
Usage: #definition
* url = "http://example.org/SearchParameter/my-fsh-search"
* name = "MyFshSearch"
* status = #active
* code = #patient
* base[0] = #Condition
* type = #reference
* expression = "Observation.subject"
* target = #Patient
* base[1] = #Patient
