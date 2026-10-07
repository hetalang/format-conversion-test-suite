if length(ARGS) != 2
  error("Expected arguments: <batch-input-json-path> <batch-result-json-path>")
end

using HetaSimulator
using DataFrames
using CSV
using JSON

batch_input_path, batch_result_path = ARGS
jobs = JSON.parsefile(batch_input_path)["cases"]

ENV["GKSwstype"] = "100"
plots_available = try
  @eval using Plots
  true
catch error
  @warn "Unable to initialize plots" exception = (error, catch_backtrace())
  false
end

function simulate_case(job, plots_available)
  project_directory = String(job["projectDirectory"])
  source_file = String(job["sourceFile"])
  output_path = String(job["outputPath"])
  settings_path = String(job["settingsPath"])
  reference_path = String(job["referencePath"])
  plot_directory = String(job["plotDirectory"])
  plot_prefix = String(job["plotPrefix"])
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
  conversion_compartments = Symbol[]
  for variable in variables
    if haskey(species_outputs, variable) && species_outputs[variable]["modelValue"] != species_outputs[variable]["referenceValue"]
      push!(conversion_compartments, Symbol(species_outputs[variable]["compartment"]))
    end
  end
  observables = unique(vcat(requested, conversion_compartments))
  platform = redirect_stdout(devnull) do
    redirect_stderr(devnull) do
      load_platform(project_directory; source = source_file)
    end
  end
  length(platform.models) == 1 || error("HetaSimulator simulation requires exactly one model")
  model = only(values(platform.models))
  saveat = collect(range(start_time, stop = start_time + duration, length = steps + 1))
  scenario = Base.invokelatest(Scenario, model, (start_time, start_time + duration); observables, saveat, events_save = (false, false))
  result_frame = DataFrame(Base.invokelatest(sim, scenario; abstol = absolute_tolerance / 10, reltol = relative_tolerance / 10, dtmax = 0.01))

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

  if plots_available
    try
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
      @warn "Unable to generate plots" exception = (error, catch_backtrace())
    end
  end
end

outcomes = Vector{Dict{String, Any}}()
total_cases = length(jobs)
for (case_index, job) in enumerate(jobs)
  case_id = String(job["caseId"])
  print("Simulating case $case_id ($case_index/$total_cases)...")
  flush(stdout)
  try
    simulate_case(job, plots_available)
    push!(outcomes, Dict("caseId" => case_id, "status" => "success"))
    println(" OK.")
  catch error
    push!(outcomes, Dict("caseId" => case_id, "status" => "failed", "message" => sprint(showerror, error)))
    println(" FAILED: $(sprint(showerror, error))")
  end
  flush(stdout)
end

open(batch_result_path, "w") do io
  JSON.print(io, Dict("cases" => outcomes), 2)
  println(io)
end
