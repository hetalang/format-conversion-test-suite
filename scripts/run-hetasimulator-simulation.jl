if length(ARGS) != 7
  error("Expected arguments: <project-directory> <source-file> <output-csv-path> <simulation-input-json-path> <reference-csv-path> <plot-directory> <plot-prefix>")
end

using HetaSimulator
using DataFrames
using CSV
using JSON

project_directory, source_file, output_path, settings_path, reference_path, plot_directory, plot_prefix = ARGS
settings = JSON.parsefile(settings_path)
time_course = settings["timeCourse"]
start_time = Float64(time_course["start"]); duration = Float64(time_course["duration"]); steps = Int(time_course["steps"])
absolute_tolerance = Float64(settings["absoluteTolerance"]); relative_tolerance = Float64(settings["relativeTolerance"])
steps > 0 || error("steps must be positive")
isfinite(start_time) && isfinite(duration) || error("time course values must be finite")
isfinite(absolute_tolerance) && absolute_tolerance > 0 || error("absolute tolerance must be positive and finite")
isfinite(relative_tolerance) && relative_tolerance > 0 || error("relative tolerance must be positive and finite")

variables = String.(settings["variables"])
species_outputs = get(settings, "speciesOutputs", Dict{String, Any}())
requested = Symbol.(variables)
conversion_compartments = [String(species_outputs[variable]["compartment"]) for variable in variables if haskey(species_outputs, variable) && species_outputs[variable]["modelValue"] != species_outputs[variable]["referenceValue"]]
observables = unique(vcat(requested, Symbol.(conversion_compartments)))
platform = load_platform(project_directory; source = source_file)
length(platform.models) == 1 || error("HetaSimulator simulation requires exactly one model")
model = only(values(platform.models))
saveat = collect(range(start_time, stop = start_time + duration, length = steps + 1))
scenario = Scenario(model, (start_time, start_time + duration); observables, saveat, events_save = (false, false))
result_frame = DataFrame(sim(scenario; abstol = absolute_tolerance / 10, reltol = relative_tolerance / 10))

output = DataFrame(time = result_frame.t)
for (index, variable_name) in enumerate(variables)
  variable = Symbol(variable_name)
  value = result_frame[!, variable]
  if haskey(species_outputs, variable_name) && species_outputs[variable_name]["modelValue"] != species_outputs[variable_name]["referenceValue"]
    compartment_name = String(species_outputs[variable_name]["compartment"])
    compartment = Symbol(compartment_name); size = result_frame[!, compartment]
    any(iszero, size) && error("Cannot convert $variable_name because compartment $compartment_name has size zero")
    value = species_outputs[variable_name]["modelValue"] == "amount" ? value ./ size : value .* size
  end
  output[!, Symbol("value_$index")] = value
end
CSV.write(output_path, output; header = ["time", variables...])

# Plotting is diagnostic-only: a plotting failure must not prevent simulation output or comparison.
try
  @eval using Plots
  reference = CSV.read(reference_path, DataFrame; normalizenames = false)
  simulation = CSV.read(output_path, DataFrame; normalizenames = false)
  nrow(reference) == nrow(simulation) || error("Reference and simulation have different row counts")
  ncol(reference) == ncol(simulation) || error("Reference and simulation have different column counts")
  mkpath(plot_directory)
  for column_index in 2:ncol(simulation)
    try
      variable = variables[column_index - 1]
      figure = Plots.plot(reference[!, 1], reference[!, column_index]; label = "Reference", color = "#1f77b4", linewidth = 2, xlabel = "Time", ylabel = variable, title = variable)
      Plots.plot!(figure, simulation[!, 1], simulation[!, column_index]; label = "HetaSimulator.jl", color = "#d62728", linewidth = 2, linestyle = :dash)
      Plots.savefig(figure, joinpath(plot_directory, "$(plot_prefix)-$(lpad(column_index - 1, 3, '0')).png"))
    catch error
      @warn "Unable to generate plot" variable = variables[column_index - 1] exception = (error, catch_backtrace())
    end
  end
catch error
  @warn "Unable to initialize plots" exception = (error, catch_backtrace())
end
