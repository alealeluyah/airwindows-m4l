# Null test against the "Airwindows Consolidated" Audio Unit (macOS only).
add_executable(nulltest nulltest.cpp)
target_link_libraries(nulltest PRIVATE airwin-core "-framework AudioToolbox" "-framework CoreFoundation")
target_compile_definitions(nulltest PRIVATE _USE_MATH_DEFINES)
